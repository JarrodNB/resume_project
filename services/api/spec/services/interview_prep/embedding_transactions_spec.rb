# Description: Real commits and concurrent connections verify save/embedding transaction boundaries.
# Index:
#   - transaction/concurrency: rollback, commit publication, provider lock release, duplicate jobs
require "rails_helper"
require "timeout"

RSpec.describe "Interview embedding transactions" do
  self.use_transactional_tests = false
  include ActiveJob::TestHelper
  let(:user) { create(:user) }
  let(:set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "Original", answer_revision: 1) }
  let(:client) { FakeEmbeddingClient.new }

  before { clear_enqueued_jobs }
  after { user.destroy! if User.exists?(user.id) }

  # Synchronizes through a separate connection with independent record instances.
  def background_sync
    owner_id, question_id = user.id, question.id
    Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        InterviewPrep::SyncQuestionEmbeddingService.call(user: User.find(owner_id), question_id: question_id,
          embedding_client: client)
      end
    end
  end

  it "queues only after commit and preserves the old vector after rollback" do
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: client)
    ActiveRecord::Base.transaction do
      InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Rolled back")
      expect(enqueued_jobs).to be_empty
      expect(question.reload.embedding).to be_nil
      raise ActiveRecord::Rollback
    end
    expect(enqueued_jobs).to be_empty
    expect(question.reload.answer_text).to eq("Original")
    expect(question.embedding.content).to end_with("Answer: Original")
    ActiveRecord::Base.transaction do
      InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Committed")
      expect(enqueued_jobs).to be_empty
    end
    expect(enqueued_jobs.size).to eq(1)
  end

  it "allows saves during provider work and rejects the stale vector" do
    entered, release = Queue.new, Queue.new
    allow(client).to receive(:embed_texts).and_wrap_original do |original, texts|
      entered << true
      release.pop
      original.call(texts)
    end
    thread = background_sync
    Timeout.timeout(5) { entered.pop }
    Timeout.timeout(5) do
      expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Edited during HTTP")).to be_success
    end
    release << true
    expect(Timeout.timeout(5) { thread.value }).to be_success
    expect(question.reload.embedding).to be_nil
  ensure
    release << true if release
    thread&.join(5)
  end

  it "serializes duplicate provider work without duplicate rows" do
    entered, release = Queue.new, Queue.new
    allow(client).to receive(:embed_texts).and_wrap_original do |original, texts|
      entered << true
      release.pop
      original.call(texts)
    end
    first = background_sync
    Timeout.timeout(5) { entered.pop }
    second = background_sync
    release << true
    Timeout.timeout(5) { [ first, second ].each(&:value) }
    expect(client.embedded_texts.size).to eq(1)
    expect(InterviewQuestionEmbedding.where(interview_question_id: question.id).count).to eq(1)
  ensure
    2.times { release << true } if release
    [ first, second ].compact.each { |thread| thread.join(5) }
  end
end
