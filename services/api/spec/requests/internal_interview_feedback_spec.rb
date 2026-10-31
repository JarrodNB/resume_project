# Claims authorize only the saved task's owner and never accept browser-supplied transcript text.
require "rails_helper"

RSpec.describe "Internal interview feedback", type: :request do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value }
  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
    interview.messages.create!(question: interview.questions.first, kind: "answer", position: 1, semantic_key: "answer", content: "I built a scheduler.")
    interview.update!(status: "completed", completed_at: Time.current)
  end
  around do |example|
    original = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "feedback-test"
    example.run
  ensure
    ENV["INTERVIEW_SERVICE_SECRET"] = original
  end

  it "requires the service bearer scheme before revealing saved dialogue" do
    task = Interviews::SessionFeedback.new.request(interview: interview).value.ai_task
    path = "/internal/interviews/feedback/#{task.id}/claim"
    post path, as: :json
    expect(response).to have_http_status(:unauthorized)
    post path, headers: { "Authorization" => "feedback-test" }, as: :json
    expect(response).to have_http_status(:unauthorized)
    post path, params: { user_id: SecureRandom.uuid, questions: [] }, headers: { "Authorization" => "Bearer feedback-test" }, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("allowed" => true)
    expect(response.parsed_body.keys).to match_array(%w[allowed interview_id record_id claimed_at])
    expect(response.body).not_to include("I built a scheduler.")
    post path, headers: { "Authorization" => "Bearer feedback-test" }, as: :json
    expect(response.parsed_body).to eq("allowed" => false)
  end
end
