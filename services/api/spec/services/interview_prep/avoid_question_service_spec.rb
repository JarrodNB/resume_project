# The written action captures only the selected saved question revision.
require "rails_helper"

RSpec.describe InterviewPrep::AvoidQuestionService do
  it "rejects stale source text without altering an existing preference" do
    user = create(:user)
    set = user.interview_question_sets.create!(number: 1)
    question = set.questions.create!(position: 1, question_text: "What did you learn?")
    expect(described_class.call(user: user, question: question, expected_revision: 1)).to be_success
    question.update!(question_text: "Describe a setback.", question_revision: 2)
    result = described_class.call(user: user, question: question, expected_revision: 1)
    expect(result).not_to be_success
    expect(user.avoided_interview_questions.pluck(:question_text)).to eq([ "What did you learn?" ])
  end
end
