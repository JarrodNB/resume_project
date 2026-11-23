# Custom questions save privately without generating or screening anything.
require "rails_helper"

RSpec.describe "Custom questions" do
  let(:user) { create(:user) }

  it "creates one typed manual question and optional answer without AI work" do
    expect(InterviewPrep::SyncQuestionEmbeddingJob).not_to receive(:perform_later)
    result = InterviewPrep::CreateCustomQuestionService.call(user: user, set_type: "knowledge", question_text: "What is a database?", answer_text: "An organized collection of data.")
    expect(result).to be_success
    set = result.value
    expect([ set.origin, set.set_type, set.number ]).to eq([ "manual", "knowledge", 1 ])
    expect(set.questions.pluck(:position, :question_text, :answer_text, :answer_revision)).to eq([[ 1, "What is a database?", "An organized collection of data.", 1 ]])
    expect(user.ai_tasks).to be_empty
    expect(set.questions.first.screened_fields).to eq([])
  end

  it "validates all five types and rejects invalid text or answer without partial sets" do
    InterviewQuestionSet::SET_TYPES.each do |type|
      expect(InterviewPrep::CreateCustomQuestionService.call(user: user, set_type: type, question_text: "Q")).to be_success
    end
    [[ "knowledge", " " , "" ], [ "knowledge", "q" * 2001, "" ], [ "general", "Q", "" ], [ "knowledge", "Q", "a" * 2001 ]].each do |type, text, answer|
      expect { expect(InterviewPrep::CreateCustomQuestionService.call(user: user, set_type: type, question_text: text, answer_text: answer)).not_to be_success }.not_to change(user.interview_question_sets, :count)
    end
  end

  it "allocates after retained generation numbers under the owner lock" do
    create(:ai_task, user: user, task_type: "generate_interview_questions", input: { "set_number" => 8 })
    result = InterviewPrep::CreateCustomQuestionService.call(user: user, set_type: "knowledge", question_text: "Q")
    expect(result.value.number).to eq(9)
  end

  it "rejects manual replacements and preserves origin in preferences after deletion" do
    set = InterviewPrep::CreateCustomQuestionService.call(user: user, set_type: "knowledge", question_text: "Q").value
    question = set.questions.first
    expect(InterviewPrep::StartQuestionTaskService.call(user: user, question: question, task_type: "regenerate_interview_question", confirmed: true).errors).to include("Custom questions cannot be replaced.")
    expect(InterviewPrep::AvoidQuestionService.call(user: user, question: question, expected_revision: 1)).to be_success
    set.destroy!
    expect(user.avoided_interview_questions.sole.origin).to eq("manual")
    expect(user.avoided_interview_questions.sole.screened_fields).to eq([])
  end
end
