# Verifies reference-only preparation and complete acceptance before speech.
require "rails_helper"

RSpec.describe "Spoken interview preparation" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.") }
  before do
    allow(Interviews::Access).to receive(:admission_enabled?).and_return(true)
    allow(Interviews::RuntimeReadiness).to receive(:ready?).and_return(true)
  end

  it "keeps saved preferences out of execution claims" do
    InterviewPreferences::SaveAvoidedQuestionService.call(user: user, question_text: "Describe an old challenge.")
    interview = Interviews::StartPreparationService.call(user: user).value
    InterviewPreferences::SaveAvoidedQuestionService.call(user: user, question_text: "A later preference?")
    claim = Interviews::ClaimOperationService.call(operation: interview.operations.first, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value.fetch(:payload)).not_to have_key(:frozen_context)
    expect(interview.reload).not_to respond_to(:frozen_context)
  end

  it "starts durable preparation instead of a fixture question and never starts speech" do
    result = Interviews::StartSessionService.call(user: user)
    expect(result).to be_success
    interview = result.value
    expect(interview.status).to eq("preparing")
    expect(interview.questions).to be_empty
    expect(interview.messages).to be_empty
    expect(interview.operations.pluck(:kind)).to eq([ "preparation" ])
    user.update!(summary: "Changed later")
    expect(interview.reload).not_to respond_to(:frozen_context)
  end
end

RSpec.describe "Preparation execution" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.") }
  let(:interview) { Interviews::StartPreparationService.call(user: user, career_focus: "laboratory").value }
  let(:operation) { interview.operations.first }
  let(:questions) do
    8.times.map { |index| { "question_type" => %w[behavioral technical knowledge][index % 3], "content" => "Question about laboratory work #{index}?" } }
  end
  let(:role) { { "title" => "Fictional laboratory technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Understand calibration" ] } }
  def claim
    Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
  end
  it "discovers and claims preparation by identity without a question or recording" do
    operation
    expect(operation.reload.delivery_job_id).to be_present
    result = claim
    expect(result).to be_success
    expect(result.value.fetch(:payload)).to include(interview_id: interview.id, user_id: user.id)
    expect(interview.career_focus).to eq("laboratory")
    expect(operation.reload.ai_task.task_type).to eq("interview_preparation")
  end
end

RSpec.describe "Atomic preparation acceptance" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.") }
  let(:interview) { Interviews::StartPreparationService.call(user: user).value }
  let(:operation) { interview.operations.first }
  let(:questions) { 8.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Describe laboratory topic #{i}?" } } }
  let(:role) { { "title" => "Fictional laboratory technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] } }
  def accept(**changes)
    Interviews::AcceptPreparationService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, role: role, questions: questions, **changes)
  end
  before { expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success }
  it "accepts all eight questions once, saving a role for review without opening speech" do
    first = accept
    expect(first).to be_success
    expect(accept.value).to eq(first.value)
    expect(interview.reload).to have_attributes(status: "ready", prepared_role: role, revision: 1)
    expect(interview.questions.pluck(:question_type)).to eq((%w[behavioral technical knowledge] * 3).first(8))
    expect(interview.messages).to be_empty
    expect(interview.operations.count).to eq(1)
    expect(operation.reload.ai_task).to be_completed
    expect(operation.ai_task.ai_task_outcomes.pluck(:status)).to eq([ "completed" ])
    expect(accept(role: role.merge("title" => "Different role"))).not_to be_success
  end
  it "rejects incomplete or duplicate question sets without exposing partial preparation" do
    expect(accept(questions: questions.first(7))).not_to be_success
    duplicated = questions.map(&:dup)
    duplicated[7]["content"] = duplicated[0]["content"]
    expect(accept(questions: duplicated)).not_to be_success
    expect(interview.reload).to be_preparing
    expect(interview.questions).to be_empty
  end
  it "rejects an expired claim and recovers the same preparation operation after restart" do
    travel 31.seconds
    expect(accept).not_to be_success
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).not_to be_success
    travel 2.seconds
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
    expect(accept).to be_success
  end
end

RSpec.describe "Preparation evidence and retention" do
  before { freeze_time }
  it "uses sparse owned project roles and excludes job-derived context requirements" do
    owner = create(:user)
    other = create(:user, summary: "Private other career")
    create(:project, user: owner, name: "Laboratory rota", role: "Technician")
    create(:career_context, user: owner, response: "Maintained equipment", requirement: "Lead a hospital department")
    result = Interviews::StartPreparationService.call(user: owner)
    expect(result).to be_success
    text = result.value.attributes.to_json
    expect(result.value).not_to respond_to(:frozen_context)
    expect(text).not_to include(other.summary, "Lead a hospital department")
  end

  it "rejects long focus without creating work; source bounds belong to Python" do
    owner = create(:user, summary: "Career evidence")
    expect(Interviews::StartPreparationService.call(user: owner, career_focus: "x" * 201)).not_to be_success
    expect(owner.interview_sessions).to be_empty
  end

  it "retries only the saved preparation and purges sources at session expiry without deleting usage" do
    owner = create(:user, summary: "Library evidence")
    interview = Interviews::StartPreparationService.call(user: owner).value
    operation = interview.operations.first
    Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
    3.times do |index|
      if index.positive?
        travel [ 2, 5 ][index - 1].seconds
        Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
      end
      Interviews::FailOperationService.call(operation: operation, attempt_id: operation.attempt_id,
        claim_generation: operation.claim_generation, code: "dependency_unavailable", retryable: true)
    end
    expect(operation.reload).to be_failed
    owner.update!(summary: "New library edit")
    expect(Interviews::RetryOperationService.call(operation: operation)).to be_success
    expect(interview.reload.attributes.to_json).not_to include("New library edit")
    interview.update!(expires_at: 1.second.ago)
    expect(Interviews::CleanupService.call).to be_success
    expect(interview.reload).to have_attributes(status: "expired", prepared_role: {})
    expect(operation.reload.ai_task).to be_present
    expect(operation.ai_task.ai_usage_attempts.count).to eq(3)
  end
end
