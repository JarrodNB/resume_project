# Description: Validates the source types accepted for persisted career library embeddings.
# Index:
#   - source type examples: library facts are accepted and unrelated records are rejected
require "rails_helper"

RSpec.describe LibraryEmbedding do
  it "accepts a library fact embedding" do
    embedding = build(:library_embedding, source_type: "LibraryFact")

    expect(embedding).to be_valid
  end

  it "rejects a source outside the career library" do
    embedding = build(:library_embedding, source_type: "InterviewQuestion")

    expect(embedding).not_to be_valid
    expect(embedding.errors[:source_type]).to include("is not included in the list")
  end
end
