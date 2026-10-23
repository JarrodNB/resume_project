# Description: Merging one career library record into another.
require "rails_helper"

RSpec.describe CareerLibrary::MergeLibraryRecordsService do
  let(:user) { create(:user) }

  it "fills blank entry fields and retains distinct dated role scopes when deleting the source" do
    target = create(:experience, user: user, location: "Perth", description: nil, end_date: nil)
    create(:experience_highlight, experience: target, content: "Built the API", position: 0)
    source = create(:experience, user: user, location: "Sydney", description: "Backend work", end_date: Date.new(2024, 1, 1))
    create(:experience_highlight, experience: source, content: "built  the api", position: 0)
    create(:experience_highlight, experience: source, content: "Led the team", position: 1)

    result = described_class.call(target: target, source: source)

    expect(result).to be_success
    target.reload
    expect(target).to have_attributes(location: "Perth", description: "Backend work", end_date: nil)
    expect(target.highlights.map(&:content)).to eq([ "Built the API", "built  the api", "Led the team" ])
    expect(target.roles.pluck(:end_date)).to eq([ nil, Date.new(2024, 1, 1) ])
    expect(target.highlights.pluck(:experience_role_id).uniq.size).to eq(2)
    expect(Experience.exists?(source.id)).to be(false)
  end

  it "merges an unsaved source without saving it" do
    target = create(:project, user: user, url: nil)
    source = Project.new(user: user, name: target.name, url: "github.com/jane/side")

    expect { described_class.call(target: target, source: source) }.not_to change(Project, :count)
    expect(target.reload.url).to eq("github.com/jane/side")
  end

  it "fills blank education dates" do
    target = create(:education, user: user, end_date: nil)
    source = create(:education, user: user, end_date: Date.new(2019, 1, 1))

    described_class.call(target: target, source: source)

    expect(target.reload.end_date).to eq(Date.new(2019, 1, 1))
  end

  it "refuses to merge a record into itself" do
    project = create(:project, user: user)

    result = described_class.call(target: project, source: project)

    expect(result.errors).to eq([ "An entry can't be merged into itself" ])
    expect(Project.exists?(project.id)).to be(true)
  end

  it "refuses to merge across users or kinds" do
    target = create(:project, user: user)

    expect(described_class.call(target: target, source: create(:project)).errors)
      .to eq([ "Only your own entries can be merged" ])
    expect(described_class.call(target: target, source: create(:education, user: user)).errors)
      .to eq([ "Only entries of the same kind can be merged" ])
  end
  it "rolls back moved bullets and source deletion when a merged role exceeds its limit" do
    target = Experiences::CreateExperienceService.call(user: user, attributes: {
      company: "Example", roles: [ { title: "Engineer", highlights: Array.new(40) { |i| { content: "Target achievement #{i}" } } } ]
    }).value
    source = Experiences::CreateExperienceService.call(user: user, attributes: {
      company: "Example", roles: [ { title: "Engineer", highlights: [ { content: "Source achievement" } ] } ]
    }).value
    target_ids = target.highlights.ids
    source_id = source.highlights.first.id

    expect { @merge_result = described_class.call(target: target, source: source) }
      .not_to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)

    expect(@merge_result).not_to be_success
    expect(Experience.exists?(source.id)).to be(true)
    expect(target.reload.highlights.ids).to match_array(target_ids)
    expect(source.reload.highlights.ids).to eq([ source_id ])
  end
end
