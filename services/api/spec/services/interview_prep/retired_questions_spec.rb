# Description: Replacing an answered question keeps a read-only copy of the old Q&A.
# Index:
#   - replacement retention: answered copies, moved vectors, unanswered slots, and read-only access
require "rails_helper"

RSpec.describe "Retired interview questions" do
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:questions) do
    5.times.map do |index|
      question_set.questions.create!(position: index + 1, question_text: "Old question number #{index}?")
    end
  end
  let(:question) { questions.first }
  let(:replacement_text) { "Tell me about a time you learned from feedback." }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  # Queues and applies one replacement through the production result consumer.
  def replace(target, text = replacement_text)
    task = create(:ai_task, user: user, task_type: "regenerate_interview_question", subject: target,
      input: { "question_set_id" => question_set.id, "question_id" => target.id,
               "question_text" => target.question_text, "question_revision" => target.question_revision,
               "answer_revision" => target.answer_revision })
    AiTasks::ApplyAiResultService.call(message: {
      "ai_task_id" => task.id, "status" => "completed", "usage" => [],
      "result" => { "interview_questions" => { "questions" => [
        { "question_text" => text, "category" => "learning_adaptation", "evidence_quotes" => [ "Career details" ] }
      ] } } })
    task.reload
  end

  it "keeps an answered question, its feedback, and its vector as a retired copy" do
    question.update!(answer_text: "I led the migration.", answer_revision: 1,
      feedback: { "strengths" => [ "Clear" ] }, feedback_question_revision: 1, feedback_answer_revision: 1)
    InterviewPrep::SyncQuestionEmbeddingService.call(user: user, question_id: question.id,
      embedding_client: FakeEmbeddingClient.new)
    embedding_id = question.reload.embedding.id

    expect(replace(question)).to be_completed
    copy = question_set.retired_questions.sole
    expect(copy).to have_attributes(position: nil, question_text: "Old question number 0?",
      answer_text: "I led the migration.", question_revision: 1, answer_revision: 1,
      feedback: { "strengths" => [ "Clear" ] }, feedback_question_revision: 1, feedback_answer_revision: 1)
    expect(copy.retired_at).to be_present
    expect(copy.embedding.id).to eq(embedding_id)
    expect(InterviewPrep::FeedbackOutdatedService.call(question: copy).value).to be(false)
    expect(question.reload).to have_attributes(question_text: replacement_text, answer_text: "", position: 1)
    expect(question.embedding).to be_nil
    expect(question_set.reload.questions.count).to eq(5)
  end

  it "keeps no copy when the replaced question was unanswered" do
    question.update!(answer_text: "   ")
    expect(replace(question)).to be_completed
    expect(question_set.retired_questions).to be_empty
  end

  it "keeps one copy per answered replacement and never reuses retired copies as slots" do
    question.update!(answer_text: "First answer", answer_revision: 1)
    replace(question)
    question.reload.update!(answer_text: "Second answer", answer_revision: question.answer_revision + 1)
    expect(replace(question.reload, "Describe a decision you made with incomplete information.")).to be_completed
    expect(question_set.retired_questions.map(&:answer_text)).to eq([ "First answer", "Second answer" ])
    expect(question_set.questions.map(&:position)).to eq([ 1, 2, 3, 4, 5 ])
  end

  it "rejects retired copies through every question mutation" do
    question.update!(answer_text: "Kept answer", answer_revision: 1)
    replace(question)
    copy = question_set.retired_questions.sole
    operations = {
      "saveInterviewAnswer" => 'answerText: "Edit"', "requestInterviewAnswerFeedback" => 'answerText: "Edit"',
      "regenerateInterviewQuestion" => "confirmed: true", "avoidInterviewQuestion" => "expectedRevision: 1"
    }
    operations.each do |name, argument|
      result = execute_graphql(<<~GQL, user: user, variables: { set: question_set.id, question: copy.id })
        mutation($set: ID!, $question: ID!) {
          #{name}(input: { questionSetId: $set, questionId: $question, #{argument} }) { errors }
        }
      GQL
      expect(result["errors"].first["message"]).to eq("Record not found")
    end
    expect(copy.reload.answer_text).to eq("Kept answer")
  end

  it "deletes retired copies with their set" do
    question.update!(answer_text: "Kept answer", answer_revision: 1)
    replace(question)
    expect(InterviewPrep::DeleteQuestionSetService.call(question_set: question_set)).to be_success
    expect(InterviewQuestion.where(interview_question_set_id: question_set.id)).to be_empty
  end

  it "enforces slot positions only for active questions" do
    expect(question_set.retired_questions.build(question_text: "Retired?", retired_at: Time.current, position: 2)).not_to be_valid
    expect(question_set.questions.build(question_text: "Active?", position: nil)).not_to be_valid
    expect { InterviewQuestion.insert_all!([ { interview_question_set_id: question_set.id, question_text: "Bad?", position: nil } ]) }
      .to raise_error(ActiveRecord::StatementInvalid, /interview_question_position/)
  end
end
