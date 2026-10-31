# Checks preparation persists commands rather than copies of saved source records.
require "rails_helper"

RSpec.describe "Reference-only interview inputs" do
  let(:user) { create(:user, summary: "Career evidence") }

  it "stores only preparation choices and returns identity-only execution claims" do
    job = create(:job, user: user, description: "x" * 20_000)
    interview = Interviews::StartPreparationService.call(user: user, job: job, career_focus: "engineering").value
    expect(interview).to be_present
    expect(interview.frozen_context).to eq({})
    expect(interview.career_focus).to eq("engineering")
    expect(interview.preparation_kind).to eq("saved_job")
    claim = Interviews::ClaimOperationService.call(operation: interview.operations.first, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value.fetch(:payload).keys).to match_array([ :version, :interview_id, :user_id, :setup ])
  end
end

RSpec.describe "Saved-job interview preparation readiness" do
  it "retains its saved-job role contract after the original job is deleted" do
    user = create(:user, summary: "Career evidence")
    job = create(:job, user: user)
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    operation = interview.operations.first
    identity = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value.slice(:attempt_id, :claim_generation)
    job.destroy!
    interview.reload
    questions = 8.times.map { |i| { "content" => "Question #{i}?", "question_type" => %w[behavioral technical knowledge][i % 3] } }
    expect(Interviews::AcceptPreparationService.call(operation: operation, **identity, role: nil, questions: questions)).to be_success
    expect(interview.reload).to have_attributes(preparation_kind: "saved_job", prepared_role: {}, job_id: nil)
    expect(Interviews::BeginService.call(interview: interview)).to be_success
  end
end
