# Description: Future saves across practice types schedule only committed, authorized question work.
# Index:
#   - save/feedback: unchanged saves, eligibility, and post-save feedback failures
require "rails_helper"

RSpec.describe "Saving answers for vector generation" do
  include ActiveJob::TestHelper
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Describe a challenge?") }

  before { clear_enqueued_jobs }

  %w[general technical knowledge].each do |type|
    it "schedules future saves including unchanged existing answers for #{type}" do
      set = user.interview_question_sets.create!(number: 1, set_type: type)
      saved = set.questions.create!(position: 1, question_text: "What did you learn?", answer_text: "Existing answer")
      expect(InterviewQuestionEmbedding.count).to eq(0)
      expect { InterviewPrep::SaveAnswerService.call(question: saved, answer_text: saved.answer_text) }
        .to have_enqueued_job(InterviewPrep::SyncQuestionEmbeddingJob).with(user.id, saved.id)
      expect(saved.reload.answer_revision).to eq(0)
    end
  end

  it "keeps the saved answer eligible when allowance prevents feedback" do
    user.update!(max_in_flight_ai_tasks: 0)
    result = nil
    expect do
      result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question,
        task_type: "review_interview_answer", answer_text: "Saved answer")
    end.to have_enqueued_job(InterviewPrep::SyncQuestionEmbeddingJob).with(user.id, question.id)
    expect(result).not_to be_success
    expect(question.reload.answer_text).to eq("Saved answer")
  end

  it "keeps embedding queued when feedback publication fails" do
    queue = instance_double(Shoryuken::Queue)
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    allow(queue).to receive(:send_message).and_raise(Seahorse::Client::NetworkingError.new(StandardError.new("offline")))
    expect do
      result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question,
        task_type: "review_interview_answer", answer_text: "Saved answer")
      expect(result).not_to be_success
    end.to have_enqueued_job(InterviewPrep::SyncQuestionEmbeddingJob).with(user.id, question.id)
  end
end
