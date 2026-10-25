# Exact frozen-focus approvals share the fenced library callback and survive preparation retries.
require "rails_helper"
require "digest"
require "json"

RSpec.describe "Interview career-focus screening" do
  let(:user) { create(:user, summary: "Career evidence") }
  let(:interview) { Interviews::StartPreparationService.call(user: user, career_focus: "Laboratory leadership").value }
  let(:operation) { interview.operations.first }
  let(:identity) do
    Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value.slice(:attempt_id, :claim_generation)
  end
  let(:digest) { Digest::SHA256.hexdigest(JSON.generate(interview.frozen_context["career_focus"])) }

  def approve(indices: [], fingerprint: digest, claim: identity)
    Interviews::RecordLibraryScreeningService.call(operation: operation, **claim,
      source_indices: indices, career_focus_sha256: fingerprint)
  end

  it "persists exact focus and source checks idempotently, then hydrates them on retry" do
    2.times do
      expect(approve(indices: [ 0 ]).value).to eq(screened_source_indices: [ 0 ], screened_career_focus_sha256: digest)
    end
    expect(user.reload.screened_fields).to include("summary")
    expect(interview.reload.frozen_context["screened_career_focus_sha256"]).to eq(digest)
    expect(Interviews::FailOperationService.call(operation: operation, **identity,
      code: "dependency_unavailable", retryable: true)).to be_success
    travel 3.seconds
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value.dig(:payload, :frozen_context, "screened_career_focus_sha256")).to eq(digest)
  end

  [ "wrong", "0" * 64, true, [], {} ].each do |bad|
    it "rejects #{bad.inspect} focus evidence before approving valid library indices" do
      expect(approve(indices: [ 0 ], fingerprint: bad)).not_to be_success
      expect(user.reload.screened_fields).to be_empty
      expect(interview.reload.frozen_context["screened_career_focus_sha256"]).to be_nil
      expect(interview.frozen_context["sources"].first["screened"]).to be(false)
    end
  end

  it "rejects invalid library indices without approving an otherwise valid focus" do
    expect(approve(indices: [ 0, 99 ])).not_to be_success
    expect(interview.reload.frozen_context["screened_career_focus_sha256"]).to be_nil
    expect(user.reload.screened_fields).to be_empty
  end

  it "rejects changed focus text against the locked current frozen value" do
    old_digest = digest
    identity
    interview.update!(frozen_context: interview.frozen_context.merge("career_focus" => "Changed focus"))
    expect(approve(indices: [ 0 ], fingerprint: old_digest)).not_to be_success
    expect(interview.reload.frozen_context["screened_career_focus_sha256"]).to be_nil
    expect(user.reload.screened_fields).to be_empty
  end

  [ "", nil, {} ].each do |focus|
    it "cannot approve an absent or invalid focus #{focus.inspect}" do
      identity
      interview.update!(frozen_context: interview.frozen_context.merge("career_focus" => focus))
      expect(approve(indices: [ 0 ])).not_to be_success
      expect(user.reload.screened_fields).to be_empty
    end
  end

  it "checks a nonempty whitespace snapshot exactly without normalizing its value" do
    identity
    interview.update!(frozen_context: interview.frozen_context.merge("career_focus" => "  "))
    expect(approve).to be_success
    expect(interview.reload.frozen_context["career_focus"]).to eq("  ")
    expect(interview.frozen_context["screened_career_focus_sha256"]).to eq(digest)
  end

  %i[attempt generation lease deadline expired abandoned ready].each do |problem|
    it "rejects #{problem} authority without persisting new checks" do
      claim = identity.dup
      case problem
      when :attempt then claim[:attempt_id] = SecureRandom.uuid
      when :generation then claim[:claim_generation] += 1
      when :lease then operation.update!(lease_expires_at: 1.second.ago)
      when :deadline then operation.update!(execution_deadline: 1.second.ago)
      when :expired then interview.update!(expires_at: 1.second.ago)
      else interview.update!(status: problem.to_s)
      end
      expect(approve(indices: [ 0 ], claim: claim)).not_to be_success
      expect(interview.reload.frozen_context["screened_career_focus_sha256"]).to be_nil
      expect(user.reload.screened_fields).to be_empty
    end
  end

  it "never permits focus approvals from a turn claim" do
    session = Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value
    question = session.questions.first
    turn = Interviews::SubmitTurnService.call(interview: session, question_id: question.id,
      recording_id: ready_interview_recording(session).id, expected_revision: session.revision,
      submission_key: "focus-turn").value
    claim = Interviews::ClaimOperationService.call(operation: turn, execution_mode: "real").value
    session.update!(frozen_context: { "sources" => [], "career_focus" => "Laboratory leadership" })
    expect(Interviews::RecordLibraryScreeningService.call(operation: turn,
      **claim.slice(:attempt_id, :claim_generation), source_indices: [],
      career_focus_sha256: Digest::SHA256.hexdigest(JSON.generate("Laboratory leadership")))).not_to be_success
    expect(session.reload.frozen_context["screened_career_focus_sha256"]).to be_nil
  end

  it "agrees with Python fingerprints for Unicode and escaped focus strings" do
    identity
    JSON.parse(File.read(Rails.root.join("../ai/tests/fixtures/job_field_fingerprints.json"))).each do |vector|
      next unless vector["value"].is_a?(String) && vector["value"].present?
      interview.update!(frozen_context: interview.frozen_context.merge("career_focus" => vector["value"]))
      expect(approve(fingerprint: vector["sha256"])).to be_success
      expect(interview.reload.frozen_context["screened_career_focus_sha256"]).to eq(vector["sha256"])
    end
  end
end
