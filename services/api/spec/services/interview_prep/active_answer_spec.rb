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
  # Chat's practice_feedback_status (services/ai/mcp_tools/interview_questions.py) relies on this:
  # a format change always advances answer_revision, so exact revisions also cover the format.
  it "advances answer_revision whenever the answer format changes" do
    drafts = { "plain_text" => { "text" => question.answer_text },
      "star" => { "situation" => "A delay", "task" => "Ship", "action" => "I planned", "result" => "On time" } }
    before = question.answer_revision
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ignored",
      answer_format: "star", answer_drafts: drafts)).to be_success
    expect(question.reload.answer_revision).to eq(before + 1)
    expect(question.answer_format_revision).to eq(question.answer_revision)
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ignored",
      answer_format: "plain_text", answer_drafts: drafts)).to be_success
    expect(question.reload.answer_revision).to eq(before + 2)
    expect(question.answer_format_revision).to eq(question.answer_revision)
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
    stub_const("DEFAULT_MAX_IN_FLIGHT_AI_TASKS", 0)
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
        "normalized_answer_sha256" => InterviewPrep::ActiveAnswer.fingerprint(question.answer_text) },
      result: { "interview_feedback" => question.feedback })
    drafts = { "plain_text" => { "text" => question.answer_text }, "car" => { "action" => "I planned" } }
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "", answer_format: "car", answer_drafts: drafts)
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "", answer_format: "plain_text", answer_drafts: drafts)
    expect(InterviewPrep::ActiveAnswer.feedback_outdated?(question.reload)).to be(true)
  end
  it "keeps formatting-only edits current within the same selected format" do
    question.update!(feedback: { "strengths" => [ "Clear" ] }, feedback_question_revision: 1, feedback_answer_revision: 0)
    create(:ai_task, user: user, task_type: "review_interview_answer", status: "completed", subject: question,
      input: { "question_revision" => 1, "answer_revision" => 0, "answer_format" => "plain_text",
        "normalized_answer_sha256" => InterviewPrep::ActiveAnswer.fingerprint(question.answer_text) },
      result: { "interview_feedback" => question.feedback })
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "ORIGINAL answer")
    expect(InterviewPrep::ActiveAnswer.feedback_outdated?(question.reload)).to be(false)
  end
end

# Shared with pytest (the chat list's SQL) and the web tests: services/ai/tests/fixtures/active_answer_cases.json.
RSpec.describe InterviewPrep::ActiveAnswer do
  fixture = JSON.parse(File.read(Rails.root.join("../ai/tests/fixtures/active_answer_cases.json")))
  let(:user) { create(:user) }
  let(:set) { user.interview_question_sets.create!(number: 1) }

  fixture.fetch("answers").each do |example|
    it "projects and counts the active answer: #{example['name']}" do
      expect(described_class.render(example["format"], example["drafts"])).to eq(example["text"])
      question = set.questions.create!(position: 1, question_text: "Q?", answer_format: example["format"],
        answer_drafts: example["drafts"], answer_text: example["text"])
      expect(described_class.answered?(question)).to be(example["answered"])
      expect(described_class.blank?(example["text"])).to be(!example["answered"])
    end
  end

  fixture.fetch("same_answer_pairs").each do |example|
    it "compares answers for freshness: #{example['name']}" do
      expect(described_class.fingerprint(example["a"]) == described_class.fingerprint(example["b"])).to be(example["same"])
    end
  end

  describe ".progress" do
    let(:question) { set.questions.create!(position: 1, question_text: "Q?") }
    let(:feedback) { { "strengths" => [ "Clear" ] } }

    it "walks the answer to feedback line" do
      expect(described_class.progress(question)).to eq(:unanswered)
      question.update!(answer_text: "Done", answer_revision: 1)
      expect(described_class.progress(question)).to eq(:answered)
      question.update!(feedback: feedback, feedback_question_revision: 1, feedback_answer_revision: 1)
      expect(described_class.progress(question)).to eq(:reviewed)
      question.update!(answer_revision: 2)
      expect(described_class.progress(question)).to eq(:outdated)
    end

    it "reports an answer that lives only in an inactive draft as unanswered" do
      question.update!(answer_format: "star", answer_text: "", answer_drafts: { "plain_text" => { "text" => "Old" } })
      expect(described_class.progress(question)).to eq(:unanswered)
    end

    it "reports getting feedback while a review task is queued" do
      question.update!(answer_text: "Done")
      task = create(:ai_task, user: user, task_type: "review_interview_answer", status: "queued", subject: question)
      expect(described_class.progress(question, latest_task: task)).to eq(:reviewing)
    end
  end
end
