# Description: Updating experiences, replacing highlights, and rolling back on failure.
require "rails_helper"

RSpec.describe Experiences::UpdateExperienceService do
  let(:experience) { create(:experience) }

  before { create(:experience_highlight, experience: experience, content: "Old bullet") }

  it "replaces highlights in the given order" do
    result = described_class.call(
      experience: experience, attributes: { title: "Senior Engineer" }, highlights: [ "First", "Second" ]
    )

    expect(result).to be_success
    expect(experience.reload.title).to eq("Senior Engineer")
    expect(experience.highlights.pluck(:content)).to eq([ "First", "Second" ])
  end

  it "leaves highlights alone when none are given" do
    described_class.call(experience: experience, attributes: { title: "Staff Engineer" })
    expect(experience.reload.highlights.pluck(:content)).to eq([ "Old bullet" ])
  end

  it "rolls back highlight changes when validation fails" do
    result = described_class.call(experience: experience, attributes: { company: "" }, highlights: [ "New" ])

    expect(result).not_to be_success
    expect(experience.reload.highlights.pluck(:content)).to eq([ "Old bullet" ])
  end
end
