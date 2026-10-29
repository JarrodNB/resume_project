# Check deterministic job HTML conversion without a database or provider calls.
require "spec_helper"
require "active_support/core_ext/object/blank"
require_relative "../../../app/services/job_board/listing_description"

RSpec.describe JobBoard::ListingDescription do
  %w[p div].each do |tag|
    it "keeps word boundaries between #{tag} blocks in a bullet" do
      description = described_class.new(
        "<h3>Requirements</h3><ul><li><#{tag}>Build <b>APIs</b>, daily.</#{tag}>" \
        "<#{tag}>Maintain services.</#{tag}></li><li>Python</li></ul>"
      )

      expect(description.text).to eq("Requirements\n\n- Build APIs, daily. Maintain services.\n- Python")
      expect(description.sections[:requirements]).to eq([ "Build APIs, daily. Maintain services.", "Python" ])
    end
  end

  it "preserves single-paragraph bullets and inline punctuation" do
    description = described_class.new("<ul><li><p>Use <b>Python</b>, daily.</p></li><li>SQL</li></ul>")
    expect(description.text).to eq("- Use Python, daily.\n- SQL")
  end

  it "keeps nested bullets separate and treats line breaks as word boundaries" do
    description = described_class.new(
      "<h3>Requirements</h3><ul><li>Cloud<br>experience:<ul><li>AWS</li></ul></li></ul>" \
      "<h3>Preferred Qualifications</h3><ul><li>Go</li></ul>"
    )
    expect(description.sections).to eq(
      requirements: [ "Cloud experience:", "AWS" ], responsibilities: [], nice_to_haves: [ "Go" ]
    )
  end

  it "lists long inline-labelled duty paragraphs one sentence per bullet" do
    description = described_class.new(
      "<p><span>Position: Staff Engineer</span></p>" \
      "<p><span>Duties: Build services (e.g. APIs, etc.) for U.S. teams. Review code. Fix defects.</span></p>" \
      "<p>Rate of pay: $110,000.00 - 220,000.00/year. Bonus included.</p>"
    )

    expect(description.text).to eq(
      "Position: Staff Engineer\n\nDuties:\n- Build services (e.g. APIs, etc.) for U.S. teams.\n" \
      "- Review code.\n- Fix defects.\n\nRate of pay: $110,000.00 - 220,000.00/year. Bonus included."
    )
    expect(description.sections[:responsibilities]).to eq([ "Build services (e.g. APIs, etc.) for U.S. teams.", "Review code.", "Fix defects." ])
  end

  it "splits a one-sentence skills list at semicolons and keeps short requirement labels" do
    description = described_class.new(
      "<p>Minimum education and experience required: Bachelor's degree and 4 years of experience.</p>" \
      "<p>Skills required: Experience with React; Experience with Kafka; Experience with Kubernetes. Any amount accepted.</p>"
    )

    expect(description.text).to include("Skills required:\n- Experience with React\n- Experience with Kafka\n- Experience with Kubernetes.\n- Any amount accepted.")
    expect(description.sections[:requirements]).to eq(
      [ "Bachelor's degree and 4 years of experience.", "Experience with React", "Experience with Kafka", "Experience with Kubernetes.", "Any amount accepted." ]
    )
  end

  it "moves long unlisted inline-labelled prose under its label and leaves other prose alone" do
    benefits = "Health benefits include medical coverage. " * 6
    description = described_class.new("<p>Benefits: #{benefits}</p><p>Mimo is an agent: a model with tools.</p><p>Note, Location: Remote</p>")

    expect(description.text).to eq("Benefits:\n#{benefits.strip}\n\nMimo is an agent: a model with tools.\n\nNote, Location: Remote")
    expect(description.sections).to eq(requirements: [], responsibilities: [], nice_to_haves: [])
  end

  it "keeps list items under a heading when an unlisted inline label follows it" do
    description = described_class.new("<h3>Requirements</h3><p>Note: Apply online.</p><ul><li>Ruby</li></ul>")
    expect(description.sections[:requirements]).to eq([ "Ruby" ])
  end
end
