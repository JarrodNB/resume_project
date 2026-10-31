# Exercises owned job references, questions-only preparation and retained turns.
# Saved source changes do not replace prepared questions.
require "rails_helper"

RSpec.describe "Saved-job spoken preparation" do
  let(:user) { create(:user, summary: "I calibrate laboratory equipment.", screened_fields: [ "summary" ]) }
  let(:job) { create(:job, user: user, title: "Laboratory technician", company: "Sample Labs",
    description: "Maintain research instruments.", requirements: [ "Calibration" ], responsibilities: [ "Maintain instruments" ],
    nice_to_haves: [ "Scheduling" ], screened_fields: [ "title", "requirements" ]) }

  it "stores an owned job reference without copying or screening its fields" do
    result = Interviews::StartPreparationService.call(user: user, job: job)
    expect(result).to be_success
    expect(result.value).to have_attributes(job_id: job.id, preparation_kind: "saved_job", frozen_context: {})
    expect(job.reload.screened_fields).to eq([ "title", "requirements" ])
    expect(job.stage).to eq("unapplied")
  end

  it "rejects another owner's job" do
    foreign_job = create(:job)
    expect(Interviews::StartPreparationService.call(user: user, job: foreign_job)).not_to be_success
    expect(user.interview_sessions).to be_empty
  end

  it "accepts questions with no model-authored role and keeps its questions for typed turns after job deletion" do
    job.update!(description: nil, requirements: [], responsibilities: [], nice_to_haves: [])
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    operation = interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value
    questions = 8.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Laboratory practice topic #{i}?" } }
    identity = claim.slice(:attempt_id, :claim_generation)
    result = Interviews::AcceptPreparationService.call(operation: operation, **identity, role: nil, questions: questions)
    expect(result).to be_success
    expect(Interviews::AcceptPreparationService.call(operation: operation, **identity, role: nil, questions: questions).value).to eq(result.value)
    expect(interview.reload.prepared_role).to eq({})
    expect(Interviews::AcceptPreparationService.call(operation: operation, **identity,
      role: { "title" => "Invented replacement", "requirements" => [], "responsibilities" => [] }, questions: questions)).not_to be_success
    expect(Interviews::BeginService.call(interview: interview)).to be_success
    job.destroy!
    interview.reload
    expect(interview.job_id).to be_nil
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
      expected_revision: interview.revision, submission_key: "job-typed-turn", transcription_mode: "typed",
      candidate_transcript: "I calibrated the instruments each morning.").value
    turn_claim = Interviews::ClaimOperationService.call(operation: turn, execution_mode: "real")
    expect(turn_claim).to be_success
    expect(turn_claim.value.fetch(:payload)).to include(interview_id: interview.id, user_id: user.id)
    expect(turn_claim.value.fetch(:payload)).not_to have_key(:interview_context)
    expect(interview.messages.first.content).to eq(questions.first.fetch("content"))
  end
end
