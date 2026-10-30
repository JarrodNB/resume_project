# Exercises saved-job targeting through durable preparation, screening and turn claims.
# Job expectations remain separate from candidate evidence and survive source changes.
require "rails_helper"

RSpec.describe "Saved-job spoken preparation" do
  let(:user) { create(:user, summary: "I calibrate laboratory equipment.", screened_fields: [ "summary" ]) }
  let(:job) { create(:job, user: user, title: "Laboratory technician", company: "Sample Labs",
    description: "Maintain research instruments.", requirements: [ "Calibration" ], responsibilities: [ "Maintain instruments" ],
    nice_to_haves: [ "Scheduling" ], screened_fields: [ "title", "requirements" ]) }

  it "freezes the owned job separately from career evidence without changing its stage" do
    result = Interviews::StartPreparationService.call(user: user, job: job)
    expect(result).to be_success
    interview = result.value
    expect(interview.job_id).to eq(job.id)
    expect(interview.frozen_context.fetch("job")).to include("title" => job.title, "company" => job.company,
      "description" => job.description, "requirements" => job.requirements, "responsibilities" => job.responsibilities)
    sources = interview.frozen_context.fetch("sources")
    expect(sources.find { |source| source["type"] == "jobs" && source["field"] == "requirements" }).to include(
      "text" => "- Calibration", "value" => [ "Calibration" ], "screened" => true)
    expect(sources.find { |source| source["type"] == "jobs" && source["field"] == "description" }).to include("screened" => false)
    expect(job.reload.stage).to eq("unapplied")
    expect(interview.operations.pluck(:kind)).to eq([ "preparation" ])
    job.update!(title: "Changed job title")
    expect(interview.reload.frozen_context.fetch("job").fetch("title")).to eq("Laboratory technician")
  end

  it "persists exact typed job checks without approving later live edits" do
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    operation = interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value
    sources = interview.reload.frozen_context.fetch("sources")
    indices = sources.each_index.select { |index| sources[index]["type"] == "jobs" }
    Jobs::UpdateJobService.call(job: job, attributes: { description: "Edited after snapshot", requirements: [ "New requirement" ] })
    2.times do
      result = Interviews::RecordLibraryScreeningService.call(operation: operation,
        **claim.slice(:attempt_id, :claim_generation), source_indices: indices)
      expect(result).to be_success
    end
    expect(job.reload.screened_fields).to include("title", "responsibilities", "nice_to_haves", "company")
    expect(job.screened_fields).not_to include("description", "requirements")
    expect(interview.reload.frozen_context.fetch("sources").values_at(*indices).all? { |source| source["screened"] }).to be(true)
    expect(interview.frozen_context.fetch("job").fetch("description")).to eq("Maintain research instruments.")
  end

  it "approves only this interview's own job even for a matching source on another owned job" do
    other_job = create(:job, user: user, title: "Laboratory technician")
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    foreign_source = { "type" => "jobs", "id" => other_job.id, "field" => "title", "value" => other_job.title,
                       "text" => other_job.title, "screened" => false }
    interview.update!(frozen_context: interview.frozen_context.merge("sources" => interview.frozen_context["sources"] + [ foreign_source ]))
    operation = interview.operations.first
    identity = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value.slice(:attempt_id, :claim_generation)
    index = interview.reload.frozen_context.fetch("sources").length - 1
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: [ index ])).to be_success
    expect(other_job.reload.screened_fields).to eq([])
    expect(interview.reload.frozen_context.fetch("sources")[index]["screened"]).to be(true)
  end

  it "reuses a live job approval at claim time only for this interview's own job" do
    other_job = create(:job, user: user, title: "Other title", screened_fields: [ "title" ])
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    foreign_source = { "type" => "jobs", "id" => other_job.id, "field" => "title", "value" => other_job.title, "text" => other_job.title }
    own_source = { "type" => "jobs", "id" => job.id, "field" => "title", "value" => job.title, "text" => job.title }
    interview.update!(frozen_context: interview.frozen_context.merge("sources" => interview.frozen_context["sources"] + [ foreign_source, own_source ]))
    claim = Interviews::ClaimOperationService.call(operation: interview.operations.first, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value.dig(:payload, :frozen_context, "sources").last(2).map { |source| source["screened"] }).to eq([ false, true ])
  end

  it "reuses no live job approval at claim time after the job is deleted" do
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    replacement = create(:job, user: user, title: job.title, screened_fields: [ "title" ])
    source = { "type" => "jobs", "id" => replacement.id, "field" => "title", "value" => replacement.title, "text" => replacement.title }
    interview.update!(frozen_context: interview.frozen_context.merge("sources" => interview.frozen_context["sources"] + [ source ]))
    job.destroy!
    expect(interview.reload.job_id).to be_nil
    claim = Interviews::ClaimOperationService.call(operation: interview.operations.first, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value.dig(:payload, :frozen_context, "sources").last["screened"]).to be(false)
  end

  it "invalidates newly approved job fields when an earlier editor saves" do
    earlier_editor = Job.find(job.id)
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    operation = interview.operations.first
    identity = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value.slice(:attempt_id, :claim_generation)
    indices = interview.frozen_context.fetch("sources").each_index.select { |index| interview.frozen_context.fetch("sources")[index]["type"] == "jobs" }
    expect(Interviews::RecordLibraryScreeningService.call(operation: operation, **identity, source_indices: indices)).to be_success
    expect(job.reload.screened_fields).to include("description", "responsibilities")
    expect(Jobs::UpdateJobService.call(job: earlier_editor, attributes: { description: "Later description" })).to be_success
    expect(job.reload.screened_fields).not_to include("description")
    expect(job.screened_fields).to include("responsibilities")
    expect(interview.reload.frozen_context.fetch("sources").values_at(*indices).all? { |source| source["screened"] }).to be(true)
  end

  it "still requires career evidence and rejects oversized required job context without creating work" do
    user.update!(summary: nil)
    expect(Interviews::StartPreparationService.call(user: user, job: job).errors.join).to include("career library is empty")
    user.update!(summary: "Career evidence")
    stub_const("Interviews::StartPreparationService::MAX_CONTEXT_BYTES", 100)
    expect(Interviews::StartPreparationService.call(user: user, job: job).errors.join).to include("too long")
    expect(user.interview_sessions).to be_empty
    expect(user.ai_tasks).to be_empty
  end

  it "accepts questions with no model-authored role and keeps the source for typed turns after job deletion" do
    job.update!(description: nil, requirements: [], responsibilities: [], nice_to_haves: [])
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    operation = interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value
    questions = 8.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Laboratory practice topic #{i}?" } }
    identity = claim.slice(:attempt_id, :claim_generation)
    result = Interviews::AcceptPreparationService.call(operation: operation, **identity, role: nil, questions: questions)
    expect(result).to be_success
    expect(Interviews::AcceptPreparationService.call(operation: operation, **identity, role: nil, questions: questions).value).to eq(result.value)
    expect(interview.reload.prepared_role).to eq("title" => "Laboratory technician", "requirements" => [], "responsibilities" => [])
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
    expect(turn_claim.value.dig(:payload, :interview_context, :personal_evidence).fetch("job").fetch("title")).to eq("Laboratory technician")
    expect(interview.messages.first.content).to eq(questions.first.fetch("content"))
  end
end
