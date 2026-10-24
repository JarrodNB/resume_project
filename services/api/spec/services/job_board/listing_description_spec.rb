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
end
