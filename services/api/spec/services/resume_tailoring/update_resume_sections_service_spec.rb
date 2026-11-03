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

  it "persists summary inclusion without deleting text, even on an empty resume" do
    result = described_class.call(resume: resume, sections: [], include_summary: false)
    expect(result).to be_success
    expect(resume.reload.include_summary).to be(false)
    expect(summary.reload.content).to eq("text" => "Old.")
    expect(described_class.call(resume: resume, sections: [], include_summary: true)).to be_success
    expect(resume.reload.include_summary).to be(true)
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
      include_summary: false,
      sections: [ { "id" => summary.id, "content" => { "text" => "a" * (TextLimits::SCREENED_TEXT + 1) } } ]
    )

    expect(result).not_to be_success
    expect(result.errors).to include(TextLimits::SECTION_TOO_LONG)
    expect(resume.reload.include_summary).to be(true)
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

  describe "section order" do
    let!(:skills) { create(:resume_section, resume: resume, section_type: "skills", title: "Skills", position: 2, content: { "items" => [] }) }

    it "saves the new order together with content" do
      result = described_class.call(
        resume: resume,
        sections: [ { "id" => summary.id, "content" => { "text" => "New." } } ],
        section_order: [ contact.id, skills.id, summary.id ]
      )

      expect(result).to be_success
      expect(result.value.sections.map(&:id)).to eq([ contact.id, skills.id, summary.id ])
      expect(summary.reload.content).to eq("text" => "New.")
    end

    it "gives the same result when repeated" do
      2.times { expect(described_class.call(resume: resume, sections: [], section_order: [ contact.id, skills.id, summary.id ])).to be_success }

      expect(resume.reload.sections.map(&:position)).to eq([ 0, 1, 2 ])
    end

    it "keeps the order when none is sent" do
      expect(described_class.call(resume: resume, sections: [])).to be_success

      expect(resume.reload.sections.map(&:id)).to eq([ contact.id, summary.id, skills.id ])
    end

    it "rejects moving contact and changes nothing" do
      result = described_class.call(
        resume: resume,
        sections: [ { "id" => summary.id, "content" => { "text" => "New." } } ],
        include_summary: false,
        section_order: [ summary.id, contact.id, skills.id ]
      )

      expect(result.errors).to eq([ described_class::CONTACT_NOT_FIRST ])
      expect(summary.reload.content).to eq("text" => "Old.")
      expect(resume.reload.include_summary).to be(true)
      expect(resume.sections.map(&:id)).to eq([ contact.id, summary.id, skills.id ])
    end

    it "rejects an order that does not list every section and changes nothing" do
      result = described_class.call(
        resume: resume,
        sections: [ { "id" => summary.id, "content" => { "text" => "New." } } ],
        section_order: [ contact.id, skills.id ]
      )

      expect(result).not_to be_success
      expect(summary.reload.content).to eq("text" => "Old.")
    end

    it "undoes the new order when a section's content is rejected" do
      result = described_class.call(
        resume: resume,
        sections: [ { "id" => summary.id, "content" => { "text" => "x" * (TextLimits::SCREENED_TEXT + 1) } } ],
        section_order: [ contact.id, skills.id, summary.id ]
      )

      expect(result).not_to be_success
      expect(resume.reload.sections.map(&:id)).to eq([ contact.id, summary.id, skills.id ])
    end
  end
end
