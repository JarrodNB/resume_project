# Save the exact visible spoken prompt without advancing or changing saved dialogue.
require "rails_helper"

RSpec.describe "Avoided spoken interview questions" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.") }
  let(:interview) { user.interview_sessions.create!(status: "active", execution_mode: "real", execution_config: Interviews::ExecutionConfiguration::PRESETS.fetch("real"), expires_at: 1.day.from_now) }
  let(:question) { interview.questions.create!(position: 0, content: "Describe a challenge.", question_type: "behavioral") }
  let(:opening) { interview.messages.create!(question: question, position: 0, semantic_key: "opening", kind: "opening", content: question.content) }
  let(:follow_up) { interview.messages.create!(question: question, position: 1, semantic_key: "follow_up", kind: "follow_up", content: "What changed afterward?") }
  def avoid(message, owner: user)
    execute_graphql(<<~GQL, user: owner, variables: {interview: interview.id, message: message.id})
      mutation($interview: ID!, $message: ID!) { avoidInterviewPrompt(input: {interviewId: $interview, messageId: $message}) { saved errors } }
    GQL
  end
  it "saves the visible follow-up once, restores its state, and preserves progress" do
    opening; follow_up
    2.times { expect(avoid(follow_up).dig("data", "avoidInterviewPrompt")).to eq("saved" => true, "errors" => []) }
    expect(user.avoided_interview_questions.pluck(:question_text)).to eq([follow_up.content])
    expect(interview.reload).to have_attributes(status: "active", revision: 0, current_question_position: 0)
    expect(interview.messages.count).to eq(2)
    snapshot = execute_graphql("query($id: ID!) { interviewSession(id: $id) { messages { id avoided } } }", user: user, variables: {id: interview.id})
    expect(snapshot.dig("data", "interviewSession", "messages").last["avoided"]).to be(true)
  end
  it "rejects stale prompts and other owners without saving a different question" do
    opening; follow_up
    expect(avoid(opening).dig("data", "avoidInterviewPrompt", "errors")).to include("Question is no longer current")
    expect(avoid(follow_up, owner: create(:user)).dig("errors", 0, "message")).to eq("Record not found")
    expect(user.avoided_interview_questions).to be_empty
  end

  it "keeps saved voice prompts available without copying them into written commands" do
    opening
    expect(avoid(opening).dig("data", "avoidInterviewPrompt", "saved")).to be(true)
    allow(Shoryuken::Client).to receive(:queues).and_return(instance_double(Shoryuken::Queue, send_message: nil))
    task = InterviewPrep::StartQuestionSetService.call(user: user)
    expect(task).to be_success
    expect(user.avoided_interview_questions.pluck(:question_text)).to eq([opening.content])
    expect(task.value.input).to include("source_version" => 1,
      "question_set_id" => task.value.subject.id)
    expect(task.value.input).not_to have_key("avoided_questions")
  end

end
