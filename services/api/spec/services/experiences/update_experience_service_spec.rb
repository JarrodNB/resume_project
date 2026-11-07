# Checks that role saves preserve unchanged bullet identities and coverage, replace
# edited bullets in order, and roll back the whole list when validation fails.
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

  it "keeps unchanged bullet IDs and coverage when editing or reordering the list" do
    original = experience.highlights.first
    original.update!(screened_fields: [ "content" ])
    removed = create(:experience_highlight, experience: experience, content: "Replace me", position: 1)

    result = described_class.call(experience: experience, attributes: {}, highlights: [ "New bullet", "Old bullet" ])

    expect(result).to be_success
    bullets = experience.reload.highlights.to_a
    expect(bullets.map(&:content)).to eq([ "New bullet", "Old bullet" ])
    expect(bullets.last.id).to eq(original.id)
    expect(bullets.last.screened_fields).to eq([ "content" ])
    expect(bullets.first.screened_fields).to eq([])
    expect(ExperienceHighlight.exists?(removed.id)).to be(false)
  end

  it "matches duplicate text to distinct saved bullets only once" do
    first = experience.highlights.first
    second = create(:experience_highlight, experience: experience, content: first.content, position: 1)

    described_class.call(experience: experience, attributes: {}, highlights: [ first.content, first.content, first.content ])

    ids = experience.reload.highlights.pluck(:id)
    expect(ids.first(2)).to eq([ first.id, second.id ])
    expect(ids.uniq.size).to eq(3)
  end

  it "rolls back retained bullet positions and deletions when the role is invalid" do
    original = experience.highlights.first
    removed = create(:experience_highlight, experience: experience, content: "Keep on failure", position: 1)

    result = described_class.call(experience: experience, attributes: { company: "" }, highlights: [ "New", original.content ])

    expect(result).not_to be_success
    expect(experience.reload.highlights.pluck(:id, :position)).to eq([ [ original.id, 0 ], [ removed.id, 1 ] ])
  end

  it "rolls back highlight changes when validation fails" do
    result = described_class.call(experience: experience, attributes: { company: "" }, highlights: [ "New" ])

    expect(result).not_to be_success
    expect(experience.reload.highlights.pluck(:content)).to eq([ "Old bullet" ])
  end
end
