# Description: Interview mutations enforce ownership and delegate validation to services.
# Index:
#   - interview operations: generated task payloads, saved answers, and cross-user protection
require "rails_helper"

RSpec.describe "Interview practice mutations" do
  let(:user) { create(:user, summary: "Team leader") }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Describe a challenge.") }

  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(instance_double(Shoryuken::Queue, send_message: nil))
  end

  it "generates a practice set with a reloadable task" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { generateInterviewQuestionSet(input: {}) { aiTask { id taskType status input } errors } }
    GQL
    payload = result.dig("data", "generateInterviewQuestionSet")
    expect(payload["errors"]).to eq([])
    expect(payload["aiTask"]).to include("taskType" => "GENERATE_INTERVIEW_QUESTIONS", "status" => "QUEUED")
    expect(user.interview_question_sets.count).to eq(1)
    expect(user.interview_question_sets.first.set_type).to eq("general")
    expect(payload["aiTask"]["input"]["set_type"]).to eq("general")
  end

  it "generates a technical set exposed on subsequent queries" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { generateInterviewQuestionSet(input: {setType: TECHNICAL}) { aiTask { input } errors } }
    GQL
    expect(result.dig("data", "generateInterviewQuestionSet", "errors")).to eq([])
    id = result.dig("data", "generateInterviewQuestionSet", "aiTask", "input", "question_set_id")
    detail = execute_graphql(<<~GQL, user: user, variables: { id: id })
      query($id: ID!) { interviewQuestionSet(id: $id) { setType } interviewQuestionSets { setType } }
    GQL
    expect(detail.dig("data", "interviewQuestionSet", "setType")).to eq("TECHNICAL")
    expect(detail.dig("data", "interviewQuestionSets").first["setType"]).to eq("TECHNICAL")
  end

  it "rejects invalid and explicit null types without creating sets" do
    [ "QUIZ", "null" ].each do |set_type|
      result = execute_graphql(<<~GQL, user: user)
        mutation { generateInterviewQuestionSet(input: {setType: #{set_type}}) { errors } }
      GQL
      expect(result["errors"].presence || result.dig("data", "generateInterviewQuestionSet", "errors").presence).to be_present
    end
    expect(user.interview_question_sets).to be_empty
  end

  it "saves and clears answers through the authorized question's set" do
    [ "My example", "" ].each do |answer|
      result = execute_graphql(<<~GQL, user: user, variables: { set: question_set.id, question: question.id, answer: answer })
        mutation($set: ID!, $question: ID!, $answer: String!) {
          saveInterviewAnswer(input: { questionSetId: $set, questionId: $question, answerText: $answer }) {
            question { id answerText answerRevision } errors
          }
        }
      GQL
      expect(result.dig("data", "saveInterviewAnswer", "errors")).to eq([])
      expect(result.dig("data", "saveInterviewAnswer", "question", "answerText")).to eq(answer)
    end
    expect(question.reload.answer_revision).to eq(2)
  end

  it "queues regeneration and feedback through their public mutations" do
    result = execute_graphql(<<~GQL, user: user, variables: { set: question_set.id, question: question.id })
      mutation($set: ID!, $question: ID!) {
        regenerateInterviewQuestion(input: { questionSetId: $set, questionId: $question }) { aiTask { id } errors }
      }
    GQL
    expect(result.dig("data", "regenerateInterviewQuestion", "errors")).to eq([])
    question.ai_tasks.last.update!(status: "failed")
    result = execute_graphql(<<~GQL, user: user, variables: { set: question_set.id, question: question.id })
      mutation($set: ID!, $question: ID!) {
        requestInterviewAnswerFeedback(input: { questionSetId: $set, questionId: $question, answerText: "My answer" }) {
          aiTask { id } errors
        }
      }
    GQL
    expect(result.dig("data", "requestInterviewAnswerFeedback", "errors")).to eq([])
    expect(question.reload.answer_text).to eq("My answer")
  end

  it "deletes an owned set and its questions" do
    question
    result = execute_graphql(<<~GQL, user: user, variables: { id: question_set.id })
      mutation($id: ID!) { deleteInterviewQuestionSet(input: { id: $id }) { questionSet { id } errors } }
    GQL
    expect(result.dig("data", "deleteInterviewQuestionSet", "errors")).to eq([])
    expect(InterviewQuestion.exists?(question.id)).to be(false)
  end

  it "rejects another user's set for every ID-taking mutation" do
    other_set = create(:user).interview_question_sets.create!(number: 1)
    other_question = other_set.questions.create!(position: 1, question_text: "Private?")
    operations = {
      "saveInterviewAnswer" => 'answerText: "Attempt"',
      "requestInterviewAnswerFeedback" => 'answerText: "Attempt"',
      "regenerateInterviewQuestion" => 'confirmed: true'
    }
    operations.each do |name, argument|
      result = execute_graphql(<<~GQL, user: user, variables: { set: other_set.id, question: other_question.id })
        mutation($set: ID!, $question: ID!) {
          #{name}(input: { questionSetId: $set, questionId: $question, #{argument} }) { errors }
        }
      GQL
      expect(result["errors"].first["message"]).to eq("Record not found")
    end
    result = execute_graphql(<<~GQL, user: user, variables: { id: other_set.id })
      mutation($id: ID!) { deleteInterviewQuestionSet(input: { id: $id }) { errors } }
    GQL
    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(other_question.reload.answer_text).to eq("")
  end

  it "rejects a question belonging to a different owned set" do
    another_set = user.interview_question_sets.create!(number: 2)
    result = execute_graphql(<<~GQL, user: user, variables: { set: another_set.id, question: question.id })
      mutation($set: ID!, $question: ID!) {
        saveInterviewAnswer(input: { questionSetId: $set, questionId: $question, answerText: "Attempt" }) { errors }
      }
    GQL
    expect(result["errors"].first["message"]).to eq("Record not found")
  end
end
