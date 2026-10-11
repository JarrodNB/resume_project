# Description: Interview practice services preserve answers, revisions, allowance checks, and queue snapshots.
# Index:
#   - InterviewPrep services: generation, explicit saving, feedback, replacement, and deletion
require "rails_helper"

RSpec.describe "Interview practice services" do
  let(:user) { create(:user, summary: "Project leader") }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Tell me about a challenge.") }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  # Starts one authorized operation using the real shared task enqueue service.
  def start_operation(task_type, **options)
    InterviewPrep::StartQuestionTaskService.call(user: user, question: question, task_type: task_type, **options)
  end

  it "allocates numbered sets and publishes committed tasks without reusing deleted numbers" do
    result = InterviewPrep::StartQuestionSetService.call(user: user)
    expect(result).to be_success
    task = result.value
    expect(task.subject.number).to eq(1)
    expect(task.input).to include("question_set_id" => task.subject_id, "set_number" => 1)
    InterviewPrep::DeleteQuestionSetService.call(question_set: task.subject)
    expect(task.reload.subject).to be_nil
    next_result = InterviewPrep::StartQuestionSetService.call(user: user)
    expect(next_result.value.subject.number).to eq(2)
  end

  it "rejects empty libraries but accepts summary-only context" do
    user.update!(summary: nil)
    expect(InterviewPrep::StartQuestionSetService.call(user: user)).not_to be_success
    expect(user.interview_question_sets).to be_empty
    expect(queue).not_to have_received(:send_message)
  end

  it "does not create a set when AI allowance is exhausted" do
    user.update!(max_in_flight_ai_tasks: 0)
    result = InterviewPrep::StartQuestionSetService.call(user: user)
    expect(result).not_to be_success
    expect(user.interview_question_sets).to be_empty
  end

  it "increments answer revisions only for actual changes, accepts the limit, and allows clearing" do
    save = ->(text) { InterviewPrep::SaveAnswerService.call(question: question, answer_text: text) }
    expect(save.call("a" * TextLimits::INTERVIEW_ANSWER)).to be_success
    expect(question.reload.answer_revision).to eq(1)
    expect(save.call(question.answer_text)).to be_success
    expect(question.reload.answer_revision).to eq(1)
    expect(save.call("a" * (TextLimits::INTERVIEW_ANSWER + 1))).not_to be_success
    expect(question.reload.answer_revision).to eq(1)
    expect(save.call("")).to be_success
    expect(question.reload.answer_revision).to eq(2)
  end

  it "saves the feedback answer and snapshots its revisions" do
    result = start_operation("review_interview_answer", answer_text: "I led a project.")
    expect(result).to be_success
    expect(result.value.input).to include("answer_text" => "I led a project.", "question_revision" => 1, "answer_revision" => 1)
    expect(question.reload.answer_text).to eq("I led a project.")
    expect(user.library_facts).to be_empty
  end

  it "keeps coaching current after capitalization and whitespace edits without changing revisions" do
    feedback = { "strengths" => [ "Clear progression" ] }
    question.update!(answer_text: "I led a project.", answer_revision: 1, feedback: feedback,
      feedback_question_revision: 1, feedback_answer_revision: 1)
    create(:ai_task, user: user, subject: question, task_type: "review_interview_answer", status: "completed",
      input: { "question_revision" => 1, "answer_revision" => 1, "answer_text" => question.answer_text },
      result: { "interview_feedback" => feedback })
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "  I LED\n a PROJECT. ")
    expect(question.reload.answer_revision).to eq(2)
    expect(question.feedback_answer_revision).to eq(1)
    expect(InterviewPrep::FeedbackOutdatedService.call(question: question).value).to be(false)
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "I led two projects.")
    expect(InterviewPrep::FeedbackOutdatedService.call(question: question.reload).value).to be(true)
  end

  it "keeps coaching outdated when its reviewed snapshot cannot be verified" do
    question.update!(answer_text: "Same text", answer_revision: 2, feedback: { "strengths" => [ "Clear" ] },
      feedback_question_revision: 1, feedback_answer_revision: 1)
    expect(InterviewPrep::FeedbackOutdatedService.call(question: question).value).to be(true)
    create(:ai_task, user: user, subject: question, task_type: "review_interview_answer", status: "completed",
      input: { "question_revision" => 1, "answer_revision" => 1, "answer_text" => "same text" },
      result: { "interview_feedback" => { "strengths" => [ "Different feedback" ] } })
    expect(InterviewPrep::FeedbackOutdatedService.call(question: question).value).to be(true)
  end

  it "rejects blank and oversized feedback answers without queueing" do
    expect(start_operation("review_interview_answer", answer_text: " ")).not_to be_success
    expect(start_operation("review_interview_answer", answer_text: "a" * 10_001)).not_to be_success
    expect(question.reload.answer_text).to eq("")
    expect(queue).not_to have_received(:send_message)
  end

  it "retains the saved answer when allowance prevents feedback" do
    user.update!(max_in_flight_ai_tasks: 0)
    expect(start_operation("review_interview_answer", answer_text: "My answer")).not_to be_success
    expect(question.reload.answer_text).to eq("My answer")
    expect(question.ai_tasks).to be_empty
  end

  it "rejects feedback if answer revisions change between saving and queue preparation" do
    allow(AiTasks::EnqueueAiTaskService).to receive(:call).and_wrap_original do |original, **arguments|
      question.reload.update!(answer_revision: question.answer_revision + 2)
      original.call(**arguments)
    end
    result = start_operation("review_interview_answer", answer_text: "Same text")
    expect(result.errors).to eq([ "The answer changed. Request feedback again." ])
    expect(question.ai_tasks).to be_empty
  end

  it "requires confirmation and snapshots other questions without clearing existing content" do
    question.update!(answer_text: "Existing", feedback: { "strengths" => [ "Specific" ] })
    question_set.questions.create!(position: 2, question_text: "What are your goals?")
    expect(start_operation("regenerate_interview_question")).not_to be_success
    result = start_operation("regenerate_interview_question", confirmed: true)
    expect(result).to be_success
    expect(result.value.input["other_questions"]).to eq([ "What are your goals?" ])
    expect(question.reload.answer_text).to eq("Existing")
    expect(question.feedback).to be_present
  end

  it "rejects a second successful feedback request for the same saved version" do
    first = start_operation("review_interview_answer", answer_text: "My answer")
    first.value.update!(status: "completed")
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "My answer")
    second = start_operation("review_interview_answer", answer_text: "My answer")
    expect(second).not_to be_success
    expect(second.errors.join).to include("already been requested for this answer version")
    expect(question.ai_tasks.count).to eq(1)
    expect(queue).to have_received(:send_message).once
  end

  it "allows feedback for a changed answer or question version" do
    first = start_operation("review_interview_answer", answer_text: "First answer")
    first.value.update!(status: "completed")
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Second answer")
    second = start_operation("review_interview_answer", answer_text: "Second answer")
    expect(second).to be_success
    second.value.update!(status: "completed")
    question.reload.update!(question_revision: 2, question_text: "A new question?")
    expect(start_operation("review_interview_answer", answer_text: "Second answer")).to be_success
    expect(question.ai_tasks.count).to eq(3)
  end

  it "allows failed feedback requests to be retried for the same version" do
    first = start_operation("review_interview_answer", answer_text: "My answer")
    first.value.update!(status: "failed")
    second = start_operation("review_interview_answer", answer_text: "My answer")
    expect(second).to be_success
    expect(second.value.input["answer_revision"]).to eq(first.value.input["answer_revision"])
  end

  it "blocks overlapping operations and saving during replacement" do
    expect(start_operation("regenerate_interview_question")).to be_success
    expect(start_operation("regenerate_interview_question")).not_to be_success
    expect(start_operation("review_interview_answer", answer_text: "New answer")).not_to be_success
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "New")).not_to be_success
    expect(question.reload.answer_text).to eq("")
    expect(question.ai_tasks.count).to eq(1)
  end

  it "allows editing during feedback and preserves old feedback metadata" do
    question.update!(feedback: { "example_answer" => "Example" }, feedback_question_revision: 1, feedback_answer_revision: 0)
    expect(start_operation("review_interview_answer", answer_text: "First")).to be_success
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Second")).to be_success
    expect(question.reload.answer_revision).to eq(2)
    expect(question.feedback_answer_revision).to eq(0)
  end

  it "retains the saved answer and marks the task failed when publishing fails" do
    allow(queue).to receive(:send_message).and_raise(Seahorse::Client::NetworkingError.new(StandardError.new("offline")))
    expect(start_operation("review_interview_answer", answer_text: "Saved")).not_to be_success
    expect(question.reload.answer_text).to eq("Saved")
    expect(question.ai_tasks.last).to be_failed
  end
end
