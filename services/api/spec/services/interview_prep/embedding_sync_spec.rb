# Description: Question-level embedding synchronization rejects stale sources and isolates owners.
# Index:
#   - synchronization: duplicate work, races, ownership, and library separation
require "rails_helper"

RSpec.describe InterviewPrep::SyncQuestionEmbeddingService do
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "My answer", answer_revision: 1) }
  let(:client) { FakeEmbeddingClient.new }

  # Runs the public question-level interface with a controlled external provider.
  def sync(owner = user)
    described_class.call(user: owner, question_id: question.id, embedding_client: client)
  end

  it "converges duplicate jobs without another provider call" do
    2.times { sync }
    expect(InterviewQuestionEmbedding.where(interview_question_id: question.id).count).to eq(1)
    expect(client.embedded_texts.size).to eq(1)
  end

  it "does not read or write another user's question" do
    sync(create(:user))
    expect(client.embedded_texts).to be_empty
    expect(question.reload.embedding).to be_nil
  end

  it "rejects late results after an answer changes, then converges on its current value" do
    allow(client).to receive(:embed_texts).and_wrap_original do |original, texts|
      InterviewPrep::SaveAnswerService.call(question: question, answer_text: "New answer")
      original.call(texts)
    end
    sync
    expect(question.reload.embedding).to be_nil
    allow(client).to receive(:embed_texts).and_call_original
    sync
    expect(question.reload.embedding.content).to end_with("Answer: New answer")
  end

  %i[clear replace delete_set delete_user].each do |action|
    it "discards provider results after #{action}" do
      question
      allow(client).to receive(:embed_texts).and_wrap_original do |original, texts|
        case action
        when :clear then InterviewPrep::SaveAnswerService.call(question: question, answer_text: "")
        when :replace then question.update!(question_text: "Replacement?", question_revision: 2, answer_text: "", answer_revision: 2)
        when :delete_set then InterviewPrep::DeleteQuestionSetService.call(question_set: question_set)
        when :delete_user then user.destroy!
        end
        original.call(texts)
      end
      sync
      expect(InterviewQuestionEmbedding.where(interview_question_id: question.id)).to be_empty
    end
  end

  it "leaves the answer persisted after provider failure" do
    allow(client).to receive(:embed_texts).and_raise(StandardError, "provider offline")
    expect { sync }.to raise_error(StandardError, "provider offline")
    expect(question.reload.answer_text).to eq("My answer")
    expect(question.embedding).to be_nil
  end

  it "uses the configured model to detect changed embedding work" do
    sync
    other = FakeEmbeddingClient.new(model: "other-model")
    described_class.call(user: user, question_id: question.id, embedding_client: other)
    expect(question.reload.embedding.model).to eq("other-model")
    expect(other.embedded_texts.size).to eq(1)
  end

  it "does not vectorize untouched answers or add career-library data" do
    untouched = question_set.questions.create!(position: 2, question_text: "Old untouched question?", answer_text: "Old answer")
    sync
    CareerLibrary::SyncLibraryEmbeddingsService.call(user: user, embedding_client: client)
    expect(untouched.reload.embedding).to be_nil
    expect(user.library_embeddings).to be_empty
    expect(user.career_contexts).to be_empty
  end
end
