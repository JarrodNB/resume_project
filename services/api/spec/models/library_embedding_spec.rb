# Description: Validates the source types accepted for persisted career library embeddings.
# Index:
#   - source type examples: career context entries are accepted and unrelated records are rejected
require "rails_helper"

RSpec.describe LibraryEmbedding do
  it "accepts a library context embedding" do
    embedding = build(:library_embedding, source_type: "CareerContext")

    expect(embedding).to be_valid
  end

  it "rejects a source outside the career library" do
    embedding = build(:library_embedding, source_type: "InterviewQuestion")

    expect(embedding).not_to be_valid
    expect(embedding.errors[:source_type]).to include("is not included in the list")
  end
end
