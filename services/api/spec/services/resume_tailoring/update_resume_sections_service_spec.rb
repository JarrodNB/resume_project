# Description: Updating a saved resume replaces section content and leaves the rest alone.
require "rails_helper"

RSpec.describe ResumeTailoring::UpdateResumeSectionsService do
  let(:user) { create(:user) }
  let(:resume) { create(:resume, user: user) }
  let!(:summary) do
    create(:resume_section, resume: resume, position: 1, title: "Summary", content: { "text" => "Old." })
  end
  let!(:contact) do
    create(
      :resume_section,
      resume: resume,
      section_type: "contact",
      title: "Contact",
      position: 0,
      content: { "full_name" => "Ada" }
    )
  end

  it "replaces section content and keeps type, title, and order" do
    result = described_class.call(
      resume: resume,
      sections: [ { "id" => summary.id, "content" => { "text" => "Backend engineer." } } ]
    )

    expect(result).to be_success
    summary.reload
    expect(summary.content).to eq("text" => "Backend engineer.")
    expect(summary.section_type).to eq("summary")
    expect(summary.title).to eq("Summary")
    expect(summary.position).to eq(1)
    expect(contact.reload.content).to eq("full_name" => "Ada")
    expect(resume.sections.order(:position).map(&:section_type)).to eq(%w[contact summary])
  end

  it "saves the same content twice" do
    payload = [ { "id" => summary.id, "content" => { "text" => "Same." } } ]

    expect(described_class.call(resume: resume, sections: payload)).to be_success
    expect(described_class.call(resume: resume, sections: payload)).to be_success
    expect(summary.reload.content).to eq("text" => "Same.")
  end

  it "rejects a section whose text is over the screen cap" do
    result = described_class.call(
      resume: resume,
      sections: [ { "id" => summary.id, "content" => { "text" => "a" * (TextLimits::SCREENED_TEXT + 1) } } ]
    )

    expect(result).not_to be_success
    expect(result.errors).to include(TextLimits::SECTION_TOO_LONG)
    expect(summary.reload.content).to eq("text" => "Old.")
  end

  it "rejects a section that isn't on this resume" do
    result = described_class.call(
      resume: resume,
      sections: [ { "id" => SecureRandom.uuid, "content" => { "text" => "Nope." } } ]
    )

    expect(result).not_to be_success
    expect(result.errors).to eq([ "That section isn't on this resume." ])
    expect(summary.reload.content).to eq("text" => "Old.")
  end

  it "rejects content that isn't an object" do
    result = described_class.call(resume: resume, sections: [ { "id" => summary.id, "content" => "Nope." } ])

    expect(result).not_to be_success
    expect(result.errors).to eq([ "Section content must be an object." ])
    expect(summary.reload.content).to eq("text" => "Old.")
  end
end
