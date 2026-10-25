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
    post "#{path}/screen_library", params: identity.merge(source_indices: [ 0 ]), as: :json
    expect(response).to have_http_status(:unauthorized)
    2.times do
      post "#{path}/screen_library", params: identity.merge(source_indices: [ 0 ]), headers: headers, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("screened_source_indices" => [ 0 ])
    end
    expect(owner.reload.screened_fields).to include("summary")
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
  it "persists a focus-only check before generation" do
    focus = "Laboratory leadership"
    interview.update!(frozen_context: interview.frozen_context.merge("career_focus" => focus))
    path = "/internal/interviews/operations/#{operation.id}"
    post "#{path}/claim", params: { execution_mode: "real" }, headers: headers, as: :json
    identity = response.parsed_body.slice("attempt_id", "claim_generation")
    digest = Digest::SHA256.hexdigest(JSON.generate(focus))
    post "#{path}/screen_library", params: identity.merge(source_indices: [], career_focus_sha256: digest), headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("screened_source_indices" => [], "screened_career_focus_sha256" => digest)
    expect(interview.reload.frozen_context["screened_career_focus_sha256"]).to eq(digest)
  end
end
