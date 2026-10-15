# Description: Saved interview answers schedule isolated vectors and invalidate obsolete content.
# Index:
#   - save lifecycle: after-commit work, invalidation, rollback, and feedback failures
require "rails_helper"

RSpec.describe "Interview Q&A embedding lifecycle" do
  include ActiveJob::TestHelper
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Describe a challenge?") }

  it "schedules question-specific work for a saved nonblank answer" do
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "I led a team.")).to be_success
    expect(enqueued_jobs.map { |job| [ job[:job].name, job[:args] ] }).to include(
      [ "InterviewPrep::SyncQuestionEmbeddingJob", [ user.id, question.id ] ])
  end
end

RSpec.describe "Interview Q&A vector generation" do
  let(:user) { create(:user, name: "Jane Doe", contact_email: "jane@example.com") }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) do
    question_set.questions.create!(position: 1, question_text: "Describe a challenge?",
      answer_text: "Jane Doe led a team.", answer_revision: 1,
      feedback: { "example_answer" => "This coaching must never be embedded." })
  end
  let(:client) { FakeEmbeddingClient.new }

  it "stores combined original text and revisions, masking contact only for the provider" do
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: client)
    row = question.reload.embedding
    expect(row.content).to eq("Question: Describe a challenge?\nAnswer: Jane Doe led a team.")
    expect(client.embedded_texts).to eq([ "Question: Describe a challenge?\nAnswer: «name» led a team." ])
    expect(row.attributes).to include("model" => client.model, "question_revision" => 1, "answer_revision" => 1)
    expect(row.embedding.to_a).to eq(FakeEmbeddingClient.vector_for(client.embedded_texts.first))
  end
end

RSpec.describe "Interview vector invalidation" do
  include ActiveJob::TestHelper
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "Old answer", answer_revision: 1) }
  let(:client) { FakeEmbeddingClient.new }

  before do
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: client)
    clear_enqueued_jobs
  end

  it "removes an edited answer's vector immediately and refreshes from persisted current text" do
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "New answer")
    expect(question.reload.embedding).to be_nil
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: client)
    expect(question.reload.embedding.content).to end_with("Answer: New answer")
    expect(question.embedding.answer_revision).to eq(2)
  end

  it "clears without generating new work" do
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "  ")
    expect(question.reload.embedding).to be_nil
    expect(enqueued_jobs).to be_empty
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: client)
    expect(question.reload.embedding).to be_nil
    expect(client.embedded_texts.size).to eq(1)
  end

  it "preserves vectors and schedules nothing for an invalid answer" do
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "x" * 10_001)).not_to be_success
    expect(question.reload.embedding.content).to end_with("Answer: Old answer")
    expect(enqueued_jobs).to be_empty
  end
end
