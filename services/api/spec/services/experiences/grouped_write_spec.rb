# Exercises grouped editing through the same services used by GraphQL.
require "rails_helper"

RSpec.describe "Grouped experience editing" do
  it "creates ordered roles and scoped highlights without client-generated IDs" do
    result = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Example", roles: [
        { title: "Lead", highlights: [ { content: "Led a team" } ] },
        { title: "Engineer", start_date: "2020-01-01" }
      ], shared_highlights: [ { content: "Built the platform" } ]
    })
    expect(result).to be_success
    entry = result.value.reload
    expect(entry.roles.pluck(:title)).to eq([ "Lead", "Engineer" ])
    expect(entry.highlights.find_by!(content: "Led a team").experience_role_id).to eq(entry.roles.first.id)
    expect(entry.highlights.find_by!(content: "Built the platform").experience_role_id).to be_nil
  end
end

RSpec.describe "Grouped experience updates" do
  def entry
    Experiences::CreateExperienceService.call(user: create(:user), attributes: { company: "Example", roles: [
      { title: "Lead", highlights: [ { content: "Scoped" } ] }, { title: "Engineer" }
    ] }).value
  end

  it "keeps role and bullet IDs through role swaps and scope changes" do
    experience = entry
    first, second = experience.roles.to_a
    bullet = experience.highlights.first
    result = Experiences::UpdateExperienceService.call(experience: experience, attributes: {
      roles: [ { id: second.id, title: "Engineer" }, { id: first.id, title: "Principal", highlights: [] } ],
      shared_highlights: [ { id: bullet.id, content: bullet.content } ]
    })
    expect(result).to be_success
    expect(experience.reload.roles.pluck(:id)).to eq([ second.id, first.id ])
    expect(bullet.reload.experience_role_id).to be_nil
  end

  it "protects bullets when a role is omitted and rolls back edits" do
    experience = entry
    result = Experiences::UpdateExperienceService.call(experience: experience, attributes: {
      company: "Changed", roles: [ { id: experience.roles.last.id, title: "Engineer" } ]
    })
    expect(result).not_to be_success
    expect(experience.reload.company).to eq("Example")
    expect(experience.roles.count).to eq(2)
    expect(experience.highlights.count).to eq(1)
  end

  it "rejects foreign child IDs and preserves approvals only for unchanged text" do
    experience = entry
    role = experience.roles.first
    role.update!(screened_fields: %w[title description])
    result = Experiences::UpdateExperienceService.call(experience: experience, attributes: {
      roles: [ { id: role.id, title: "Principal" }, { id: experience.roles.last.id, title: "Engineer" } ]
    })
    expect(result).to be_success
    expect(role.reload.screened_fields).to eq([ "description" ])
    other = entry
    result = Experiences::UpdateExperienceService.call(experience: experience, attributes: {
      roles: [ { id: other.roles.first.id, title: "Foreign" } ]
    })
    expect(result).not_to be_success
    expect(experience.reload.roles.count).to eq(2)
  end
end

RSpec.describe "Grouped bullet moves" do
  it "requires explicit scope for grouped targets and synchronizes same-entry scope moves" do
    experience = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Example", roles: [ { title: "Lead", highlights: [ { content: "Built" } ] }, { title: "Engineer" } ]
    }).value
    bullet = experience.highlights.first
    expect(Experiences::MoveHighlightService.call(highlight: bullet, experience: experience, position: 0)).not_to be_success
    expect { Experiences::MoveHighlightService.call(highlight: bullet, experience: experience, position: 0, experience_role_id: nil) }
      .to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(experience.user_id)
    expect(bullet.reload.experience_role_id).to be_nil
    role = experience.roles.last
    result = Experiences::MoveHighlightService.call(highlight: bullet, experience: experience, position: 0, experience_role_id: role.id)
    expect(result).to be_success
    expect(bullet.reload.experience_role_id).to eq(role.id)
  end
end

RSpec.describe "Complete entry matching" do
  it "does not match one overlapping role or different bullet scope" do
    user = create(:user)
    grouped = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example", roles: [
      { title: "Lead" }, { title: "Engineer" }
    ], shared_highlights: [ { content: "Shared" } ] }).value
    separate = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example", title: "Lead" }).value
    expect(CareerLibrary::FindMatchingLibraryRecordService.call(record: separate, candidates: [ grouped ]).value).to be_nil
  end
end

RSpec.describe "Explicit role removal" do
  it "reassigns the last bullet before deleting its old role" do
    experience = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Example", roles: [ { title: "Lead", highlights: [ { content: "Keep" } ] }, { title: "Engineer" } ]
    }).value
    bullet = experience.highlights.first
    result = Experiences::UpdateExperienceService.call(experience: experience, attributes: {
      roles: [ { id: experience.roles.last.id, title: "Engineer" } ],
      shared_highlights: [ { id: bullet.id, content: bullet.content } ]
    })
    expect(result).to be_success
    expect(experience.reload.roles.count).to eq(1)
    expect(bullet.reload.experience_role_id).to be_nil
  end
end

RSpec.describe "Grouped manual merges" do
  it "preserves distinct roles, dates, descriptions, scopes and stable bullet IDs" do
    user = create(:user)
    target = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example", roles: [ { title: "Lead", description: "Leadership", highlights: [ { content: "Same words" } ] } ] }).value
    source = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example", roles: [ { title: "Engineer", start_date: "2020-01-01", description: "Engineering", highlights: [ { content: "Same words" } ] } ], shared_highlights: [ { content: "Same words" } ] }).value
    ids = target.highlights.ids + source.highlights.ids
    result = CareerLibrary::MergeLibraryRecordsService.call(target: target, source: source)
    expect(result).to be_success
    expect(target.reload.roles.pluck(:title, :description)).to eq([ [ "Lead", "Leadership" ], [ "Engineer", "Engineering" ] ])
    expect(target.highlights.ids).to match_array(ids)
    expect(target.highlights.count).to eq(3)
    expect(Experience.exists?(source.id)).to be(false)
  end
end

RSpec.describe "Grouped import merge boundary" do
  it "distinguishes unsaved role bullets from shared bullets and retains all descriptions" do
    user = create(:user)
    target = Experiences::CreateExperienceService.call(user: user, attributes: {
      company: "Example", description: "Existing entry", roles: [ { title: "Lead", description: "Existing role" }, { title: "Engineer" } ]
    }).value
    source = user.experiences.new(company: "Example", title: "Lead", description: "Incoming entry")
    lead = source.roles.build(title: "Lead", description: "Incoming role", position: 0)
    engineer = source.roles.build(title: "Engineer", position: 1)
    source.highlights.build(content: "Shared", position: 0)
    source.highlights.build(content: "Lead only", position: 1, experience_role: lead)
    source.highlights.build(content: "Engineer only", position: 2, experience_role: engineer)
    result = CareerLibrary::MergeLibraryRecordsService.call(target: target, source: source)
    expect(result).to be_success
    expect(target.reload.roles.count).to eq(2)
    expect(target.description).to eq("Existing entry\n\nIncoming entry")
    expect(target.roles.first.description).to eq("Existing role\n\nIncoming role")
    expect(target.highlights.find_by!(content: "Shared").experience_role_id).to be_nil
    expect(target.highlights.find_by!(content: "Lead only").experience_role_id).to eq(target.roles.first.id)
    expect(target.highlights.find_by!(content: "Engineer only").experience_role_id).to eq(target.roles.last.id)
    expect(source).not_to be_persisted
  end
end

RSpec.describe "Grouped bounds and ordering" do
  it "rejects empty roles, too many roles and too many bullets atomically" do
    user = create(:user)
    [ { roles: [] }, { roles: Array.new(21) { { title: "Engineer" } } },
      { roles: [ { title: "Engineer", highlights: Array.new(41) { { content: "Bullet" } } } ] } ].each do |input|
      result = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example" }.merge(input))
      expect(result).not_to be_success
      expect(user.experiences.count).to eq(0)
    end
  end

  it "orders entries by role dates while keeping source role order" do
    user = create(:user)
    older = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Older", roles: [ { title: "Engineer", start_date: "2020-01-01", end_date: "2021-01-01" } ] }).value
    newer = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Newer", roles: [
      { title: "First in source", start_date: "2018-01-01", end_date: "2019-01-01" },
      { title: "Latest", start_date: "2022-01-01", end_date: "2024-01-01" }
    ] }).value
    expect(user.experiences.most_recent_first.ids).to eq([ newer.id, older.id ])
    expect(newer.roles.pluck(:title)).to eq([ "First in source", "Latest" ])
  end
end

RSpec.describe "Ambiguous legacy writes" do
  it "rejects string bullet replacement when a single-role entry has shared evidence" do
    entry = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Example", roles: [ { title: "Engineer" } ], shared_highlights: [ { content: "Shared" } ]
    }).value
    result = Experiences::UpdateExperienceService.call(experience: entry, attributes: {}, highlights: [ "Replacement" ])
    expect(result).not_to be_success
    expect(entry.reload.highlights.pluck(:content)).to eq([ "Shared" ])
  end

  it "does not silently ignore string bullets supplied alongside nested roles" do
    user = create(:user)
    result = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example", roles: [ { title: "Engineer" } ] }, highlights: [ "Keep me" ])
    expect(result).not_to be_success
    expect(user.experiences.count).to eq(0)
  end
end

RSpec.describe "Repeated role merge identity" do
  it "matches each source role at most once and preserves repeated distinct role scopes" do
    user = create(:user)
    target = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example", roles: [ { title: "Engineer" } ] }).value
    source = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example", roles: [
      { title: "Engineer", highlights: [ { content: "First assignment" } ] }, { title: "Engineer", highlights: [ { content: "Second assignment" } ] }
    ] }).value
    result = CareerLibrary::MergeLibraryRecordsService.call(target: target, source: source)
    expect(result).to be_success
    expect(target.reload.roles.count).to eq(2)
    expect(target.highlights.pluck(:experience_role_id).uniq.size).to eq(2)
  end
end

RSpec.describe "Ongoing grouped ordering" do
  it "compares the current roles rather than a group's older finished role" do
    user = create(:user)
    older_current = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Older current", roles: [
      { title: "Earlier", start_date: "2015-01-01", end_date: "2020-01-01" }, { title: "Current", start_date: "2020-01-01" }
    ] }).value
    newer_current = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Newer current", roles: [
      { title: "Current", start_date: "2025-01-01" }
    ] }).value
    expect(user.experiences.most_recent_first.ids).to eq([ newer_current.id, older_current.id ])
  end
end

RSpec.describe "Optional nested lists" do
  it "treats null nested highlights as omitted without deleting evidence" do
    entry = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Example", roles: [ { title: "Engineer", highlights: [ { content: "Keep" } ] } ]
    }).value
    result = Experiences::UpdateExperienceService.call(experience: entry, attributes: {
      roles: [ { id: entry.roles.first.id, title: "Engineer", highlights: nil } ]
    })
    expect(result).to be_success
    expect(entry.reload.highlights.pluck(:content)).to eq([ "Keep" ])
  end
end

RSpec.describe "Stale legacy move scope" do
  it "rejects an omitted scope if the target acquired another role before the move" do
    user = create(:user)
    source = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Source", title: "Engineer" }, highlights: [ "Keep" ]).value
    target = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Target", title: "Engineer" }).value
    bullet = source.highlights.first
    service = Experiences::MoveHighlightService.new(highlight: bullet, experience: target, position: 0)
    target.roles.create!(title: "Another", position: 1)
    expect(service.call).not_to be_success
    expect(bullet.reload.experience_id).to eq(source.id)
  end
end

RSpec.describe "Explicit bullet and role removal" do
  it "removes explicitly named bullets with their role in one transaction" do
    entry = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Example", roles: [ { title: "Lead", highlights: [ { content: "Remove" } ] }, { title: "Engineer" } ]
    }).value
    bullet = entry.highlights.first
    result = Experiences::UpdateExperienceService.call(experience: entry, attributes: {
      roles: [ { id: entry.roles.last.id, title: "Engineer" } ], removed_highlight_ids: [ bullet.id ]
    })
    expect(result).to be_success
    expect(entry.reload.roles.pluck(:title)).to eq([ "Engineer" ])
    expect(entry.highlights.count).to eq(0)
  end
end

RSpec.describe "Explicit removal ownership" do
  it "rejects foreign, duplicate, or retained removal IDs atomically" do
    user = create(:user)
    entry = Experiences::CreateExperienceService.call(user: user, attributes: { company: "Example", title: "Engineer" }, highlights: [ "Keep" ]).value
    foreign = Experiences::CreateExperienceService.call(user: create(:user), attributes: { company: "Private", title: "Engineer" }, highlights: [ "Private" ]).value.highlights.first
    bullet = entry.highlights.first
    [ [ foreign.id ], [ bullet.id, bullet.id ], [ bullet.id ] ].each do |ids|
      result = Experiences::UpdateExperienceService.call(experience: entry, attributes: {
        shared_highlights: [ { id: bullet.id, content: "Keep" } ], removed_highlight_ids: ids
      })
      expect(result).not_to be_success
      expect(entry.reload.highlights.ids).to eq([ bullet.id ])
    end
    expect(foreign.reload.content).to eq("Private")
  end
end
