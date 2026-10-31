# Exercises the owned job selection at the public start interface, excluding private sources.
require "rails_helper"

RSpec.describe "Saved-job spoken interview GraphQL" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.") }
  let(:job) { create(:job, user: user, title: "Laboratory technician", company: nil, description: "Maintain instruments.") }
  let(:mutation) do
    'mutation($jobId: ID!) { startInterview(input: {jobId: $jobId}) { interview { id jobContext { id title company description requirements responsibilities niceToHaves } } errors } }'
  end

  before do
    allow(Interviews::Access).to receive(:admission_enabled?).and_return(true)
    allow(Interviews::RuntimeReadiness).to receive(:ready?).and_return(true)
  end

  it "starts owned job practice and exposes only its safe saved job context" do
    result = execute_graphql(mutation, user: user, variables: { jobId: job.id })
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "startInterview", "errors")).to eq([])
    expect(result.dig("data", "startInterview", "interview", "jobContext")).to include(
      "id" => job.id, "title" => job.title, "company" => nil, "description" => job.description)
    expect(Types::InterviewSessionType.fields).not_to include("frozenContext")
  end

  it "rejects missing or foreign job selection without creating interview work" do
    [ create(:job).id, SecureRandom.uuid ].each do |id|
      result = execute_graphql(mutation, user: user, variables: { jobId: id })
      expect(result.dig("errors", 0, "message")).to eq("Record not found")
    end
    expect(user.interview_sessions).to be_empty
  end

  it "keeps saved interviews linked when the job is archived" do
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    result = execute_graphql('mutation($id: ID!) { archiveJob(input: { id: $id }) { errors } }', user: user, variables: { id: job.id })
    expect(result.dig("data", "archiveJob", "errors")).to eq([])
    expect(interview.reload.job_id).to eq(job.id)
    expect(interview.frozen_context).to eq({})
  end

  it "shows live labels after edits and publishes detached navigation when the job is deleted" do
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    preparation = interview.operations.preparation.first
    identity = Interviews::ClaimOperationService.call(operation: preparation, execution_mode: "real").value.slice(:attempt_id, :claim_generation)
    questions = 8.times.map { |index| { "question_type" => %w[behavioral technical knowledge][index % 3], "content" => "Saved laboratory topic #{index}?" } }
    expect(Interviews::AcceptPreparationService.call(operation: preparation, **identity, role: nil, questions: questions)).to be_success
    expect(Interviews::BeginService.call(interview: interview)).to be_success
    revision = interview.revision
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
      expected_revision: revision, submission_key: "delete-job-pending-turn", transcription_mode: "typed",
      candidate_transcript: "I checked the calibration records.").value
    query = '{ recentInterviewSessions { id jobContext { id title company } } }'
    job.update!(title: "Renamed vacancy", company: "Changed company")
    saved = execute_graphql(query, user: user).dig("data", "recentInterviewSessions", 0, "jobContext")
    expect(saved).to eq("id" => job.id, "title" => "Renamed vacancy", "company" => "Changed company")
    expect(execute_graphql(query, user: create(:user)).dig("data", "recentInterviewSessions")).to eq([])

    allow(Interviews::PublishSnapshotService).to receive(:call).and_call_original
    deleted = Records::DestroyRecordService.call(record: user.jobs.find(job.id))
    expect(deleted).to be_success
    expect(Interviews::PublishSnapshotService).to have_received(:call).with(interview_id: interview.id)
    saved = execute_graphql(query, user: user).dig("data", "recentInterviewSessions", 0, "jobContext")
    expect(saved).to be_nil
    expect(interview.reload.frozen_context).to eq({})
    expect(interview.revision).to eq(revision)
    expect(interview.messages.first.content).to eq(questions.first.fetch("content"))
    claimed = Interviews::ClaimOperationService.call(operation: turn, execution_mode: "real")
    expect(claimed).to be_success
    expect(claimed.value.fetch(:payload)).not_to have_key(:candidate_transcript)
  end

  it "removes expired job context from public history and purges it with the saved text" do
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    interview.update!(expires_at: 1.second.ago)
    expect(execute_graphql('{ recentInterviewSessions { id jobContext { title } } }', user: user).dig("data", "recentInterviewSessions")).to eq([])
    expect(execute_graphql("{ interviewSession(id: \"#{interview.id}\") { jobContext { title } } }", user: user).dig("errors", 0, "message")).to eq("Interview expired")
    expect(Interviews::CleanupService.call).to be_success
    expect(interview.reload.frozen_context).to eq({})
    expect(interview.prepared_role).to eq({})
  end

  it "keeps live job navigation when deletion is rejected" do
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    reject_deletion = -> { errors.add(:base, "Deletion unavailable"); throw :abort }
    Job.set_callback(:destroy, :before, reject_deletion)
    begin
      deleted = Records::DestroyRecordService.call(record: user.jobs.find(job.id))
      expect(deleted.errors).to include("Deletion unavailable")
      expect(interview.reload.job_id).to eq(job.id)
    ensure
      Job.skip_callback(:destroy, :before, reject_deletion)
    end
  end
end
