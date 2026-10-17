# Description: Database constraints enforce unique Q&A vectors and cascading deletion.
# Index:
#   - persistence: uniqueness and removal through question/set/user ownership
require "rails_helper"

RSpec.describe InterviewQuestionEmbedding do
  let(:user) { create(:user) }
  let(:set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "My answer") }
  let(:row) do
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id,
      embedding_client: FakeEmbeddingClient.new)
    question.reload.embedding
  end

  it "rejects duplicate rows at the database boundary" do
    attributes = row.attributes.except("id", "created_at", "updated_at")
    expect do
      described_class.transaction(requires_new: true) { described_class.create!(attributes) }
    end.to raise_error(ActiveRecord::RecordNotUnique)
  end

  it "cascades even a direct question SQL deletion" do
    id = row.id
    InterviewQuestion.where(id: question.id).delete_all
    expect(described_class.exists?(id)).to be(false)
  end

  %i[set user].each do |owner|
    it "removes vectors on #{owner} deletion" do
      id = row.id
      public_send(owner).destroy!
      expect(described_class.exists?(id)).to be(false)
    end
  end
end
