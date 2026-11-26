# Keeps personal recall cues separate from reviewed answers and model work.
require "rails_helper"

RSpec.describe "Interview memory anchors" do
  include ActiveJob::TestHelper
  let(:user) { create(:user) }
  let(:set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "My answer", answer_revision: 1) }

  it "saves a cue without changing answer revisions or enqueueing embedding work" do
    question.update!(screened_fields: %w[question_text answer_text], feedback: { "strengths" => [ "Clear" ] }, feedback_question_revision: 1, feedback_answer_revision: 1)
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: FakeEmbeddingClient.new)
    embedding_id = question.reload.embedding.id
    clear_enqueued_jobs
    result = InterviewPrep::SaveAnswerService.call(question: question, answer_text: question.answer_text, memory_anchor: "Launch: listen, plan, deliver")
    expect(result).to be_success
    expect(question.reload.memory_anchor).to eq("Launch: listen, plan, deliver")
    expect(question.answer_revision).to eq(1)
    expect(enqueued_jobs).to be_empty
    expect(question.embedding.id).to eq(embedding_id)
    expect(question.screened_fields).to eq(%w[question_text answer_text])
    expect(question.feedback).to eq({ "strengths" => [ "Clear" ] })
    expect(InterviewPrep::ActiveAnswer.feedback_outdated?(question)).to be(false)
  end

  it "accepts 600 characters, rejects oversized cues atomically, and allows clearing" do
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "My answer", memory_anchor: "a" * 600)).to be_success
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Changed answer", memory_anchor: "a" * 601)).not_to be_success
    expect(question.reload).to have_attributes(answer_text: "My answer", answer_revision: 1, memory_anchor: "a" * 600)
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "My answer", memory_anchor: "")).to be_success
    expect(question.reload.memory_anchor).to eq("")
  end

  it "keeps ordinary unchanged-answer saves eligible for embedding work" do
    clear_enqueued_jobs
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "My answer", memory_anchor: "")).to be_success
    expect(enqueued_jobs.map { |job| job[:job] }).to include(InterviewPrep::SyncQuestionEmbeddingJob)
  end

  it "saves both drafts before feedback allowance failure without copying cues into commands" do
    stub_const("DEFAULT_MAX_IN_FLIGHT_AI_TASKS", 0)
    result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question,
      task_type: "review_interview_answer", answer_text: "Updated answer", memory_anchor: "Private recall cue")
    expect(result).not_to be_success
    expect(question.reload).to have_attributes(answer_text: "Updated answer", memory_anchor: "Private recall cue")
    expect(question.ai_tasks).to be_empty
  end

  it "never embeds memory anchors or sends them in feedback task commands" do
    allow(Shoryuken::Client).to receive(:queues).and_return(instance_double(Shoryuken::Queue, send_message: nil))
    result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question,
      task_type: "review_interview_answer", answer_text: "My answer", memory_anchor: "Private recall cue")
    expect(result).to be_success
    expect(result.value.input.to_json).not_to include("Private recall cue", "memory_anchor")
    client = FakeEmbeddingClient.new
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: client)
    expect(client.embedded_texts.join).not_to include("Private recall cue")
  end

  it "keeps both saved drafts when feedback publication fails" do
    queue = instance_double(Shoryuken::Queue)
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    allow(queue).to receive(:send_message).and_raise(Seahorse::Client::NetworkingError.new(StandardError.new("offline")))
    result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question,
      task_type: "review_interview_answer", answer_text: "Updated answer", memory_anchor: "Private cue")
    expect(result).not_to be_success
    expect(question.reload).to have_attributes(answer_text: "Updated answer", memory_anchor: "Private cue")
    expect(question.ai_tasks.last).to be_failed
  end
end
