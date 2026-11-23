# Checks independent candidate drafts through the same save interface used by practice.
require "rails_helper"

RSpec.describe "Saved practice answer formats" do
  include ActiveJob::TestHelper
  let(:user) { create(:user) }
  let(:set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "Original\n answer") }

  it "keeps independent drafts and projects only the selected structured answer" do
    result = InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ignored",
      answer_format: "car", answer_drafts: { "plain_text" => { "text" => "Original\n answer" },
        "car" => { "context" => "A delay", "action" => "I planned", "result" => "" } })
    expect(result).to be_success
    expect(question.reload.answer_format).to eq("car")
    expect(question.answer_text).to eq("Context: A delay\n\nAction: I planned")
    expect(question.answer_drafts.dig("plain_text", "text")).to eq("Original\n answer")
  end
  it "preserves inactive drafts for legacy saves and does not advance active revisions for inactive edits" do
    drafts = { "plain_text" => { "text" => question.answer_text }, "car" => { "action" => "Alternative" } }
    expect do
      expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ignored", answer_format: "plain_text", answer_drafts: drafts)).to be_success
    end.not_to have_enqueued_job(InterviewPrep::SyncQuestionEmbeddingJob)
    expect(question.answer_revision).to eq(0)
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "New plain")).to be_success
    expect(question.reload.answer_drafts.dig("car", "action")).to eq("Alternative")
    expect(question.answer_revision).to eq(1)
  end

  it "rejects unsupported keys, types and oversize rendered drafts atomically" do
    [ { "car" => { "surprise" => "text" } }, { "car" => { "action" => 7 } },
      { "car" => { "action" => "a" * TextLimits::INTERVIEW_ANSWER } }, { "unknown" => {} } ].each do |drafts|
      expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ignored", answer_format: "car", answer_drafts: drafts)).not_to be_success
      expect(question.reload.answer_text).to eq("Original\n answer")
      expect(question.answer_revision).to eq(0)
    end
  end

  it "saves every draft and selection before feedback allowance failure" do
    user.update!(max_in_flight_ai_tasks: 0)
    result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question,
      task_type: "review_interview_answer", answer_text: "ignored", answer_format: "star",
      answer_drafts: { "star" => { "action" => "I planned" }, "car" => { "result" => "Alternative" } })
    expect(result).not_to be_success
    expect(question.reload.answer_text).to eq("Action: I planned")
    expect(question.answer_format).to eq("star")
    expect(question.answer_drafts.dig("car", "result")).to eq("Alternative")
  end

  it "changes active revision when equal projected text uses another format while preserving screening" do
    question.update!(answer_text: "Action: I planned", screened_fields: [ "answer_text" ])
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ignored", answer_format: "car",
      answer_drafts: { "plain_text" => { "text" => question.answer_text }, "car" => { "action" => "I planned" } })
    expect(question.reload.answer_revision).to eq(1)
    expect(question.screened_fields).to include("answer_text")
  end
  it "keeps equal-text vectors and exact screening without another embedding request" do
    question.update!(answer_text: "Action: I planned", screened_fields: [ "answer_text" ])
    client = FakeEmbeddingClient.new
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: client)
    vector_id = question.reload.embedding.id
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ignored", answer_format: "car",
      answer_drafts: { "car" => { "action" => "I planned" } })
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id, embedding_client: client)
    expect(question.reload.embedding.id).to eq(vector_id)
    expect(question.embedding.answer_revision).to eq(question.answer_revision)
    expect(client.embedded_texts.length).to eq(1)
    expect(question.screened_fields).to include("answer_text")
  end

  it "removes every draft when the question is deleted" do
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ignored", answer_format: "carl",
      answer_drafts: { "carl" => { "learning" => "A lesson" }, "car" => { "action" => "Alternative" } })
    expect(InterviewPrep::DeleteQuestionService.call(question: question)).to be_success
    expect(InterviewQuestion.exists?(question.id)).to be(false)
  end
  it "keeps old coaching outdated after returning to a previously reviewed format" do
    question.update!(feedback: { "strengths" => [ "Clear" ] }, feedback_question_revision: 1, feedback_answer_revision: 0)
    create(:ai_task, user: user, task_type: "review_interview_answer", status: "completed", subject: question,
      input: { "question_revision" => 1, "answer_revision" => 0, "answer_format" => "plain_text",
        "normalized_answer_sha256" => InterviewPrep::FeedbackOutdatedService.answer_fingerprint(question.answer_text) },
      result: { "interview_feedback" => question.feedback })
    drafts = { "plain_text" => { "text" => question.answer_text }, "car" => { "action" => "I planned" } }
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "", answer_format: "car", answer_drafts: drafts)
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "", answer_format: "plain_text", answer_drafts: drafts)
    expect(InterviewPrep::FeedbackOutdatedService.call(question: question.reload).value).to be(true)
  end
  it "keeps formatting-only edits current within the same selected format" do
    question.update!(feedback: { "strengths" => [ "Clear" ] }, feedback_question_revision: 1, feedback_answer_revision: 0)
    create(:ai_task, user: user, task_type: "review_interview_answer", status: "completed", subject: question,
      input: { "question_revision" => 1, "answer_revision" => 0, "answer_format" => "plain_text",
        "normalized_answer_sha256" => InterviewPrep::FeedbackOutdatedService.answer_fingerprint(question.answer_text) },
      result: { "interview_feedback" => question.feedback })
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ORIGINAL answer")
    expect(InterviewPrep::FeedbackOutdatedService.call(question: question.reload).value).to be(false)
  end
end
