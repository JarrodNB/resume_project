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
    expect(claim.fetch("payload")).to include("interview_id" => interview.id, "user_id" => owner.id)
    identity = claim.slice("attempt_id", "claim_generation")
    expect(claim.fetch("payload").keys).to match_array(%w[version interview_id user_id setup])
    expect(owner.reload.screened_fields).not_to include("summary")
    body = identity.merge(role: { title: "Laboratory technician", responsibilities: [ "Maintain instruments" ], requirements: [ "Calibration" ] },
      questions: 8.times.map { |i| { question_type: %w[behavioral technical knowledge][i % 3], content: "Laboratory question #{i}?" } })
    2.times do
      post "#{path}/accept_preparation", params: body, headers: headers, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("status")).to eq("ready")
    end
    expect(interview.questions.count).to eq(8)
    expect(interview.messages).to be_empty
  end

  it "accepts explicit null role for an owned saved-job claim and persists its exact source checks" do
    job = create(:job, user: owner, title: "Laboratory technician", company: nil,
      requirements: [], responsibilities: [], nice_to_haves: [])
    prepared = Interviews::StartPreparationService.call(user: owner, job: job).value
    path = "/internal/interviews/operations/#{prepared.operations.first.id}"
    post "#{path}/claim", params: { execution_mode: "real" }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    claim = response.parsed_body
    expect(claim.fetch("payload")).to include("interview_id" => prepared.id, "user_id" => owner.id)
    identity = claim.slice("attempt_id", "claim_generation")
    post "#{path}/accept_preparation", params: identity.merge(role: nil,
      questions: 8.times.map { |i| { question_type: %w[behavioral technical knowledge][i % 3], content: "Laboratory topic #{i}?" } }),
      headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(prepared.reload.prepared_role).to eq({})
    expect(prepared.questions.count).to eq(8)
  end
  it "has no library screening callback" do
    expect { Rails.application.routes.recognize_path("/internal/interviews/operations/#{operation.id}/screen_library", method: :post) }.to raise_error(ActionController::RoutingError)
  end
end
