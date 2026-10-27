# Adopt previously saved work once, without polling or dispatching before HTTP startup.
require "rails_helper"

RSpec.describe "Legacy interview delivery adoption" do
  self.use_transactional_tests = false

  around do |example|
    previous = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :solid_queue
    example.run
  ensure
    ActiveJob::Base.queue_adapter = previous
  end

  before do
    @nudges = []
    allow(AiExecutions::NudgeService).to receive(:call) do |**input|
      @nudges << input
      ServiceResult.new(success: true, value: true, errors: [])
    end
    @user = create(:user)
    @interview = Interviews::CreateFixtureService.call(user: @user).value
    @operation = @interview.operations.first
    SolidQueue::Job.where("arguments LIKE ?", "%#{@operation.id}%").destroy_all
    @operation.update_columns(delivery_job_id: nil, recovery_job_id: nil)
  end

  after do
    @user.interview_sessions.flat_map { |interview| interview.operations.ids }.each do |id|
      SolidQueue::Job.where("arguments LIKE ?", "%#{id}%").destroy_all
    end
    @user.destroy!
  end

  it "atomically adopts pending work once and leaves the immediate HTTP path untouched" do
    previous_nudges = @nudges.size
    expect(Interviews::BackfillDeliveryService.call).to be_success
    stored = SolidQueue::Job.find_by!(active_job_id: @operation.reload.delivery_job_id)
    expect(stored.class_name).to eq("AiExecutions::DispatchJob")
    expect(stored.arguments.fetch("arguments")).to eq([ "interviews", @operation.id ])
    expect(@operation.execution_count).to eq(0)
    expect(Interviews::BackfillDeliveryService.call).to be_success
    expect(SolidQueue::Job.where("arguments LIKE ?", "%#{@operation.id}%").count).to eq(1)
    expect(@nudges.size).to eq(previous_nudges)
  end
  it "adopts an already expired running lease and recovers it through the durable worker" do
    claim = Interviews::ClaimOperationService.call(operation: @operation).value
    SolidQueue::Job.where("arguments LIKE ?", "%#{@operation.id}%").destroy_all
    @operation.update_columns(recovery_job_id: nil, lease_expires_at: 1.second.ago)
    expect(Interviews::BackfillDeliveryService.call).to be_success
    stored = SolidQueue::Job.find_by!(active_job_id: @operation.reload.recovery_job_id)
    expect(stored.class_name).to eq("AiExecutions::RecoveryJob")
    original_watchdog = stored.active_job_id
    expect(Interviews::BackfillDeliveryService.call).to be_success
    expect(@operation.reload.recovery_job_id).to eq(original_watchdog)
    worker = SolidQueue::Process.register(kind: "Worker", name: "legacy-adoption-#{SecureRandom.uuid}", pid: Process.pid, hostname: "test")
    SolidQueue::ReadyExecution.claim([ "ai_executions" ], 1, worker.id).each(&:perform)
    expect(@operation.reload).to have_attributes(status: "pending", failure_code: "lease_expired",
      attempt_id: claim.fetch(:attempt_id), claim_generation: claim.fetch(:claim_generation), execution_count: 1)
    expect(@operation.ai_task.ai_usage_attempts.count).to eq(1)
    expect(SolidQueue::Job.find_by!(active_job_id: @operation.delivery_job_id).class_name).to eq("AiExecutions::DispatchJob")
  ensure
    worker&.deregister
  end

  it "retires expired legacy work instead of sending it to an executor" do
    @interview.update!(status: "completed", completed_at: 1.hour.ago - 1.second)
    result = Interviews::BackfillDeliveryService.call
    expect(result.value).to include(expired: 1, dispatched: 0)
    expect(@operation.reload).to be_expired
    expect(@operation.delivery_job_id).to be_nil
  end

  it "does not queue provider-disabled saved speech" do
    real = Interviews::CreateFixtureService.call(user: @user, execution_mode: "real").value
    speech = real.operations.speech.first
    expect(Interviews::BackfillDeliveryService.call).to be_success
    expect(speech.reload.delivery_job_id).to be_nil
    expect(SolidQueue::Job.where("arguments LIKE ?", "%#{speech.id}%")).not_to exist
  end

  it "rolls back an adoption marker when durable queue insertion fails" do
    connection = ApplicationRecord.connection
    constraint = "reject_legacy_delivery_probe"
    connection.add_check_constraint(:solid_queue_jobs, "class_name <> 'AiExecutions::DispatchJob'", name: constraint)
    expect { Interviews::BackfillDeliveryService.call }.to raise_error(SolidQueue::Job::EnqueueError)
    expect(@operation.reload.delivery_job_id).to be_nil
    expect(SolidQueue::Job.where("arguments LIKE ?", "%#{@operation.id}%")).not_to exist
  ensure
    connection.remove_check_constraint(:solid_queue_jobs, name: constraint) if connection&.check_constraint_exists?(:solid_queue_jobs, name: constraint)
  end
end
