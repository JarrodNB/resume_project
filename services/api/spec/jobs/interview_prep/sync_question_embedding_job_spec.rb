# Description: Background Q&A generation handles configuration, retries, and deleted owners.
# Index:
#   - perform: real synchronization with a fake external provider
require "rails_helper"

RSpec.describe InterviewPrep::SyncQuestionEmbeddingJob do
  include ActiveJob::TestHelper
  let(:user) { create(:user) }
  let(:set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "My answer") }
  let(:client) { FakeEmbeddingClient.new }

  before do
    clear_enqueued_jobs
    allow(Embeddings::OpenAiEmbeddingClient).to receive(:configured?).and_return(true)
    allow(Embeddings::OpenAiEmbeddingClient).to receive(:new).and_return(client)
  end

  it "embeds a saved answer without feedback and converges duplicate jobs" do
    question.update!(answer_text: "")
    perform_enqueued_jobs do
      expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "My answer")).to be_success
    end
    described_class.perform_now(user.id, question.id)
    expect(question.reload.embedding).to be_present
    expect(client.embedded_texts.size).to eq(1)
    expect(question.feedback).to eq({})
  end

  it "logs missing configuration without even creating a provider client" do
    allow(Embeddings::OpenAiEmbeddingClient).to receive(:configured?).and_return(false)
    allow(Rails.logger).to receive(:warn)
    described_class.perform_now(user.id, question.id)
    expect(Embeddings::OpenAiEmbeddingClient).not_to have_received(:new)
    expect(Rails.logger).to have_received(:warn).with(/skipping interview Q&A/)
    expect(question.reload.embedding).to be_nil
  end

  it "retries temporary provider failures without affecting the answer" do
    allow(client).to receive(:embed_texts).and_raise(OpenAI::Errors::APIConnectionError.new(url: "https://example.test"))
    expect { described_class.perform_now(user.id, question.id) }
      .to have_enqueued_job(described_class).with(user.id, question.id)
    expect(question.reload.answer_text).to eq("My answer")
    expect(question.embedding).to be_nil
  end

  it "still invalidates cleared answers when provider configuration is missing" do
    described_class.perform_now(user.id, question.id)
    expect(question.reload.embedding).to be_present
    allow(Embeddings::OpenAiEmbeddingClient).to receive(:configured?).and_return(false)
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "")).to be_success
    described_class.perform_now(user.id, question.id)
    expect(question.reload.embedding).to be_nil
    expect(client.embedded_texts.size).to eq(1)
  end

  it "ignores deleted owners and questions" do
    question_id = question.id
    user_id = user.id
    user.destroy!
    described_class.perform_now(user_id, question_id)
    expect(client.embedded_texts).to be_empty
  end
end
