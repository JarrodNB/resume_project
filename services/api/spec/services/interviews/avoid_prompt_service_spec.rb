# Non-question dialogue cannot become an avoided prompt through the service interface.
require "rails_helper"

RSpec.describe Interviews::AvoidPromptService do
  it "rejects an answer message without changing preferences or dialogue" do
    user = create(:user)
    interview = user.interview_sessions.create!(status: "active", execution_mode: "real", execution_config: Interviews::ExecutionConfiguration::PRESETS.fetch("real"), expires_at: 1.day.from_now)
    question = interview.questions.create!(position: 0, content: "Describe a challenge.", question_type: "behavioral")
    answer = interview.messages.create!(question: question, kind: "answer", content: "My private answer.", semantic_key: "answer", position: 0)
    expect(described_class.call(interview: interview, message_id: answer.id)).not_to be_success
    expect(user.avoided_interview_questions).to be_empty
    expect(answer.reload.content).to eq("My private answer.")
  end
end
