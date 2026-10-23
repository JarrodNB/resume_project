# Verifies canonical roles through the public write interfaces and retained database seams.
require "rails_helper"

RSpec.describe "Canonical experience contract" do
  it "writes only canonical title and date values and never flattens grouped reads" do
    result = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Example", roles: [ { title: "Lead", start_date: "2022-01-01" }, { title: "Engineer" } ]
    })
    expect(result).to be_success
    entry = result.value
    flat = ActiveRecord::Base.connection.select_one("SELECT title, start_date, end_date FROM experiences WHERE id = '#{entry.id}'")
    expect(flat.values).to eq([ nil, nil, nil ])
    expect(entry.title).to be_nil
    expect(entry.start_date).to be_nil
    expect(entry.end_date).to be_nil
  end

  it "requires at least one canonical role even for direct model creation" do
    entry = Experience.new(user: create(:user), company: "Example")
    expect(entry).not_to be_valid
    expect(entry.errors[:roles]).to include("must contain at least one title")
  end
  it "keeps a legacy single-role description scoped after adding a second role" do
    entry = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
      company: "Example", title: "Engineer", description: "Introduced the engineering role"
    }).value
    role = entry.roles.first
    expect(entry.description).to be_nil
    expect(role.description).to eq("Introduced the engineering role")
    result = Experiences::UpdateExperienceService.call(experience: entry, attributes: {
      roles: [ { id: role.id, title: role.title }, { title: "Lead" } ]
    })
    expect(result).to be_success
    expect(entry.reload.description).to be_nil
    expect(entry.roles.map { |item| [ item.title, item.description ] }).to eq([
      [ "Engineer", "Introduced the engineering role" ], [ "Lead", nil ]
    ])
    text = CareerLibrary::BuildEmbeddingTextsService.call(user: entry.user).value.find { |item| item[:source_id] == entry.id }[:content]
    expect(text).to include("Engineer at Example: Introduced the engineering role")
    expect(text.scan("Introduced the engineering role").size).to eq(1)
  end

end
