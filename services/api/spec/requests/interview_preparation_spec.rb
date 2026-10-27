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

  it "accepts explicit null role for an owned saved-job claim and persists its exact source checks" do
    job = create(:job, user: owner, title: "Laboratory technician", company: nil,
      requirements: [], responsibilities: [], nice_to_haves: [])
    prepared = Interviews::StartPreparationService.call(user: owner, job: job).value
    path = "/internal/interviews/operations/#{prepared.operations.first.id}"
    post "#{path}/claim", params: { execution_mode: "real" }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    claim = response.parsed_body
    expect(claim.dig("payload", "frozen_context", "job", "title")).to eq(job.title)
    identity = claim.slice("attempt_id", "claim_generation")
    indices = claim.dig("payload", "frozen_context", "sources").each_index.to_a
    post "#{path}/screen_library", params: identity.merge(source_indices: indices), headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("screened_source_indices")).to eq(indices)
    post "#{path}/accept_preparation", params: identity.merge(role: nil,
      questions: 8.times.map { |i| { question_type: %w[behavioral technical knowledge][i % 3], content: "Laboratory topic #{i}?" } }),
      headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(prepared.reload.prepared_role).to eq("title" => job.title, "responsibilities" => [], "requirements" => [])
    expect(prepared.questions.count).to eq(8)
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

  [ "\u00a0", "\u202f", "\u2003" ].each do |focus|
    it "persists an accepted Unicode whitespace focus #{focus.codepoints.inspect} exactly" do
      started = Interviews::StartPreparationService.call(user: owner, career_focus: focus)
      expect(started).to be_success
      session = started.value
      expect(session.frozen_context["career_focus"]).to eq(focus)
      path = "/internal/interviews/operations/#{session.operations.first.id}"
      post "#{path}/claim", params: { execution_mode: "real" }, headers: headers, as: :json
      expect(response).to have_http_status(:ok)
      identity = response.parsed_body.slice("attempt_id", "claim_generation")
      digest = Digest::SHA256.hexdigest(JSON.generate(focus))
      post "#{path}/screen_library", params: identity.merge(source_indices: [], career_focus_sha256: digest), headers: headers, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["screened_career_focus_sha256"]).to eq(digest)
      expect(session.reload.frozen_context["career_focus"]).to eq(focus)
      expect(session.frozen_context["screened_career_focus_sha256"]).to eq(digest)
    end
  end
end
