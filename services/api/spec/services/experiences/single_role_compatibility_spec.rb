# Checks that old single-role writes populate the canonical role without losing stable bullets.
require "rails_helper"

RSpec.describe "Single role compatibility" do
  it "creates a canonical role and assigns bullets to it through the old write contract" do
    result = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Acme", title: "Engineer", start_date: Date.new(2020, 1, 1)
    }, highlights: [ "Built something" ])

    expect(result).to be_success
    experience = result.value.reload
    expect(experience.roles.map { |role| [ role.title, role.start_date, role.position ] }).to eq([
      [ "Engineer", Date.new(2020, 1, 1), 0 ]
    ])
    expect(experience.highlights.first.experience_role_id).to eq(experience.roles.first.id)
  end

  def create_experience
    Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Acme", title: "Engineer", start_date: Date.new(2020, 1, 1)
    }, highlights: [ "Original" ]).value
  end

  it "updates canonical role dates and title without changing the role or omitted bullets" do
    experience = create_experience
    role_id = experience.roles.first.id
    bullet_id = experience.highlights.first.id
    result = Experiences::UpdateExperienceService.call(experience: experience,
      attributes: { title: "Lead", end_date: Date.new(2024, 12, 1) })

    expect(result).to be_success
    expect(experience.reload.roles.first.attributes.slice("id", "title", "end_date")).to eq(
      "id" => role_id, "title" => "Lead", "end_date" => Date.new(2024, 12, 1))
    expect(experience.highlights.first.id).to eq(bullet_id)
  end

  it "projects canonical fields for writes that do not edit them" do
    experience = create_experience
    experience.roles.first.update!(title: "Canonical title")
    result = Experiences::UpdateExperienceService.call(experience: experience, attributes: { location: "Remote" })
    expect(result).to be_success
    expect(experience.reload.title).to eq("Canonical title")
  end

  it "rolls back canonical changes and replacement bullets when validation fails" do
    experience = create_experience
    result = Experiences::UpdateExperienceService.call(experience: experience,
      attributes: { title: "Lead", company: "" }, highlights: [ "New" ])
    expect(result).not_to be_success
    expect(experience.reload.roles.first.title).to eq("Engineer")
    expect(experience.highlights.pluck(:content)).to eq([ "Original" ])
  end

  it "keeps grouped entries safe from legacy writes while allowing explicit merges" do
    experience = create_experience
    experience.roles.create!(title: "Developer", position: 1)
    source = create(:experience, user: experience.user)
    update = Experiences::UpdateExperienceService.call(experience: experience,
      attributes: { title: "Changed" }, highlights: [ "New" ])
    source_title = source.title
    merge = CareerLibrary::MergeLibraryRecordsService.call(target: experience, source: source)
    expect(update).not_to be_success
    expect(merge).to be_success
    expect(experience.reload.roles.pluck(:title)).to eq([ "Engineer", "Developer", source_title ])
    expect(experience.highlights.pluck(:content)).to eq([ "Original" ])
  end

  it "keeps canonical dates synchronized when a merge fills a missing date" do
    experience = create_experience
    Experiences::UpdateExperienceService.call(experience: experience, attributes: { start_date: nil })
    source = create(:experience, user: experience.user, start_date: Date.new(2018, 1, 1))
    source_title = source.title
    result = CareerLibrary::MergeLibraryRecordsService.call(target: experience, source: source)
    expect(result).to be_success
    expect(experience.reload.roles.find_by!(title: source_title).start_date).to eq(Date.new(2018, 1, 1))
  end
end
