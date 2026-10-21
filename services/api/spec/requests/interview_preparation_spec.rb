# Checks preparation's authenticated HTTP contract and private source boundary.
require "rails_helper"

RSpec.describe "Internal interview preparation", type: :request do
  let(:owner) { create(:user, summary: "I calibrate laboratory equipment.") }
  let(:interview) { Interviews::StartPreparationService.call(user: owner).value }
  let(:operation) { interview.operations.first }
  let(:headers) { { "Authorization" => "Bearer preparation-service-test" } }
  around do |example|
    original = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "preparation-service-test"
    example.run
  ensure
    ENV["INTERVIEW_SERVICE_SECRET"] = original
  end

  it "requires service authority and accepts one complete role through a fenced callback" do
    path = "/internal/interviews/operations/#{operation.id}"
    post "#{path}/claim", params: { execution_mode: "real", user_id: owner.id }, as: :json
    expect(response).to have_http_status(:unauthorized)
    post "#{path}/claim", params: { execution_mode: "real" }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    claim = response.parsed_body
    expect(claim.dig("payload", "frozen_context", "sources", 0, "text")).to eq(owner.summary)
    identity = claim.slice("attempt_id", "claim_generation")
    body = identity.merge(role: { title: "Laboratory technician", responsibilities: ["Maintain instruments"], requirements: ["Calibration"] },
      questions: 9.times.map { |i| { question_type: %w[behavioral technical knowledge][i % 3], content: "Laboratory question #{i}?" } })
    2.times do
      post "#{path}/accept_preparation", params: body, headers: headers, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("status")).to eq("ready")
    end
    expect(interview.questions.count).to eq(9)
    expect(interview.messages).to be_empty
  end
end
