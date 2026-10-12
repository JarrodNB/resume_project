# Description: Practice set ownership, ordering, deletion, and question validation specs.
# Index:
#   - InterviewQuestionSet: persistence invariants and independent answer storage
require "rails_helper"

RSpec.describe InterviewQuestionSet do
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }

  it "defaults legacy sets to general, validates types, and keeps the type immutable" do
    expect(question_set.reload.set_type).to eq("general")
    expect(user.interview_question_sets.build(number: 2, set_type: "quiz")).not_to be_valid
    technical = user.interview_question_sets.create!(number: 2, set_type: "technical")
    expect { technical.update!(set_type: "general") }.to raise_error(ActiveRecord::ReadonlyAttributeError)
    expect(technical.reload.set_type).to eq("technical")
  end

  # Builds a question within the user's practice set.
  def add_question(position, **attributes)
    question_set.questions.create!(position: position, question_text: "Question #{position}?", **attributes)
  end

  it "stores five questions in position order with revision defaults" do
    [ 5, 3, 1, 4, 2 ].each { |position| add_question(position) }
    expect(question_set.questions.reload.pluck(:position)).to eq([ 1, 2, 3, 4, 5 ])
    expect(question_set.questions.first).to have_attributes(
      answer_text: "", question_revision: 1, answer_revision: 0, feedback: {}
    )
  end

  it "allows the same set number for another user but not the same user" do
    question_set
    expect(user.interview_question_sets.build(number: 1)).not_to be_valid
    expect(create(:user).interview_question_sets.create!(number: 1)).to be_persisted
  end

  it "rejects duplicate and out-of-range question slots" do
    add_question(1)
    expect(question_set.questions.build(position: 1, question_text: "Other?")).not_to be_valid
    expect(question_set.questions.build(position: 6, question_text: "Other?")).not_to be_valid
  end

  it "stores answers and feedback separately from library facts" do
    question = add_question(1, answer_text: "My answer", answer_revision: 1,
      feedback: { "strengths" => [ "Clear" ] }, feedback_question_revision: 1, feedback_answer_revision: 1)
    expect(question.reload.feedback).to eq("strengths" => [ "Clear" ])
    expect(user.library_facts).to be_empty
    expect(question.update(answer_text: "")).to be(true)
    expect(question.update(answer_text: "a" * 10_001)).to be(false)
  end

  it "rejects blank questions and invalid revisions" do
    question = add_question(1)
    expect(question.update(question_text: " ")).to be(false)
    expect(question.update(question_text: "Question?", question_revision: 0)).to be(false)
    expect(question.update(question_revision: 1, answer_revision: -1)).to be(false)
  end

  it "deletes questions but preserves task usage records" do
    question = add_question(1)
    task = user.ai_tasks.create!(task_type: "analyze_gaps", subject: question)
    question_set.destroy!
    expect(InterviewQuestion.exists?(question.id)).to be(false)
    expect(task.reload.subject).to be_nil
  end

  it "lists newest sets first and deletes them with their user" do
    question_set
    newer = user.interview_question_sets.create!(number: 2, created_at: 1.minute.from_now)
    expect(user.interview_question_sets.first).to eq(newer)
    add_question(1)
    user.destroy!
    expect(InterviewQuestionSet.exists?(question_set.id)).to be(false)
    expect(InterviewQuestion.where(interview_question_set_id: question_set.id)).to be_empty
  end
end
