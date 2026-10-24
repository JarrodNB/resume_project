# Saved resume edits validate the new document and leave invalid content unsaved.
require "rails_helper"

RSpec.describe ResumeTailoring::UpdateResumeService do
  let(:resume) { create(:resume) }

  it "replaces Markdown and keeps the page target" do
    expect(described_class.call(resume: resume, markdown: "# Revised")).to be_success
    expect(resume.reload.attributes.slice("markdown", "target_pages")).to eq("markdown" => "# Revised", "target_pages" => 1)
  end

  it "rejects blank and oversized documents" do
    original = resume.markdown
    [ " ", "a" * (Resume::MAX_MARKDOWN_LENGTH + 1) ].each do |markdown|
      expect(described_class.call(resume: resume, markdown: markdown)).not_to be_success
      expect(resume.reload.markdown).to eq(original)
    end
  end
end
