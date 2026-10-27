# Verify queue-process interruption is recoverable without rediscovering domain work.
require "rails_helper"

RSpec.describe "Interrupted AI queue delivery" do
  self.use_transactional_tests = false

  around do |example|
    previous = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :solid_queue
    example.run
  ensure
    ActiveJob::Base.queue_adapter = previous
  end

  before do
    allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "offline" ]))
    @user = create(:user, summary: "I maintain inventory systems.")
    @operation = Interviews::StartPreparationService.call(user: @user).value.operations.first
    @process_ids = []
    @maintenance_job_ids = []
    @job = AiExecutions::DispatchJob.perform_later("interviews", @operation.id)
    @operation.update!(delivery_job_id: @job.job_id)
  end

  after do
    jobs = SolidQueue::Job.where("arguments LIKE ?", "%#{@operation.id}%")
    jobs = jobs.or(SolidQueue::Job.where(active_job_id: @maintenance_job_ids))
    AiJobRecovery.where(active_job_id: jobs.pluck(:active_job_id)).delete_all
    jobs.destroy_all
    SolidQueue::Process.where(id: @process_ids).delete_all
    @user.destroy!
  end

  def claimed_delivery
    process = SolidQueue::Process.register(kind: "Worker", name: "interrupted-#{SecureRandom.uuid}", pid: Process.pid, hostname: "test")
    @process_ids << process.id
    SolidQueue::ReadyExecution.claim([ "ai_executions" ], 1, process.id).first
  end

  it "recovers persisted failed delivery even when the process notification was lost" do
    claimed_delivery.failed_with(SolidQueue::Processes::ProcessMissingError.new)
    expect(SolidQueue::FailedExecution.joins(:job).where(job: { active_job_id: @job.job_id })).to exist
    AiExecutions::RecoverInterruptedJobsJob.perform_now
    expect(SolidQueue::ReadyExecution.joins(:job).where(job: { active_job_id: @job.job_id })).to exist
    expect(AiJobRecovery.find_by!(active_job_id: @job.job_id).recovery_count).to eq(1)
  end

  it "caps process-death recovery across manual queue retries and exposes failure" do
    4.times do
      claimed_delivery.failed_with(SolidQueue::Processes::ProcessMissingError.new)
      AiExecutions::RecoverInterruptedJobsJob.perform_now
    end
    receipt = AiJobRecovery.find_by!(active_job_id: @job.job_id)
    expect(receipt.recovery_count).to eq(3)
    expect(receipt.exhausted_at).to be_present
    expect(@operation.reload).to be_failed
    expect(SolidQueue::FailedExecution.joins(:job).where(job: { active_job_id: @job.job_id })).to exist
  end

  it "does not let an old delivery job stop a newly scheduled delivery" do
    old = @job
    Interviews::ScheduleOperationService.call(operation: @operation)
    old.stop_delivery
    expect(@operation.reload).to be_pending
    expect(AiExecutions::NudgeService).not_to receive(:call)
    old.perform_now
    expect(@operation.reload).to be_pending
  end

  it "recovers later failures after retaining a full batch of exhausted diagnostic rows" do
    @maintenance_job_ids = Array.new(100) { Interviews::CleanupJob.perform_later.job_id }
    process = SolidQueue::Process.register(kind: "Worker", name: "exhausted-batch-#{SecureRandom.uuid}", pid: Process.pid, hostname: "test")
    @process_ids << process.id
    claimed = SolidQueue::ReadyExecution.claim([ "maintenance" ], 100, process.id)
    expect(claimed.size).to eq(100)
    claimed.each { |execution| execution.failed_with(SolidQueue::Processes::ProcessMissingError.new) }
    @maintenance_job_ids.each { |id| AiJobRecovery.create!(active_job_id: id, recovery_count: 3) }

    AiExecutions::RecoverInterruptedJobsJob.perform_now
    receipts = AiJobRecovery.where(active_job_id: @maintenance_job_ids)
    expect(receipts.where.not(exhausted_at: nil).count).to eq(100)
    exhaustion_times = receipts.pluck(:active_job_id, :exhausted_at).to_h

    claimed_delivery.failed_with(SolidQueue::Processes::ProcessMissingError.new)
    AiExecutions::RecoverInterruptedJobsJob.perform_now
    expect(SolidQueue::ReadyExecution.joins(:job).where(job: { active_job_id: @job.job_id })).to exist
    expect(AiJobRecovery.find_by!(active_job_id: @job.job_id).recovery_count).to eq(1)

    AiExecutions::RecoverInterruptedJobsJob.perform_now
    expect(AiJobRecovery.find_by!(active_job_id: @job.job_id).recovery_count).to eq(1)
    expect(receipts.pluck(:active_job_id, :exhausted_at).to_h).to eq(exhaustion_times)
    expect(receipts.distinct.pluck(:recovery_count)).to eq([ 3 ])
    expect(SolidQueue::FailedExecution.joins(:job).where(job: { active_job_id: @maintenance_job_ids }).count).to eq(100)
  end

  it "keeps fallback delivery durable when HTTP202 has not produced a claim" do
    allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: true, errors: []))
    @job.perform_now
    expect(@operation.reload).to be_pending
    expect(SolidQueue::ScheduledExecution.joins(:job).where(job: { active_job_id: @job.job_id })).to exist
  end

  it "delivers missed immediate work through the same persisted-claim path" do
    allow(AiExecutions::NudgeService).to receive(:call) do |feature:, operation_id:|
      expect(feature).to eq("interviews")
      expect(Interviews::ClaimOperationService.call(operation: InterviewSessionOperation.find(operation_id), execution_mode: "real")).to be_success
      ServiceResult.new(success: true, value: true, errors: [])
    end
    @job.perform_now
    expect(@operation.reload).to be_running
    expect(SolidQueue::Job.find_by!(active_job_id: @operation.recovery_job_id).class_name).to eq("AiExecutions::RecoveryJob")
  end

  it "does not let an old watchdog stop a new pending cycle or expired claim" do
    expect(Interviews::ClaimOperationService.call(operation: @operation, execution_mode: "real")).to be_success
    stored = SolidQueue::Job.find_by!(active_job_id: @operation.reload.recovery_job_id)
    old = AiExecutions::RecoveryJob.new(*stored.arguments.fetch("arguments"))
    old.job_id = stored.active_job_id
    expect(Interviews::FailOperationService.call(operation: @operation, attempt_id: @operation.attempt_id,
      claim_generation: @operation.claim_generation, code: "execution_failed", retryable: false)).to be_success
    expect(Interviews::RetryOperationService.call(operation: @operation)).to be_success
    old.stop_delivery
    expect(@operation.reload).to be_pending
    expect(Interviews::ClaimOperationService.call(operation: @operation, execution_mode: "real")).to be_success
    travel 31.seconds
    old.stop_delivery
    expect(@operation.reload).to be_running
  end

  it "retries explicit transient database failures but exposes programmer errors" do
    allow(AiExecutions::Features).to receive(:state).and_raise(ActiveRecord::Deadlocked)
    @job.perform_now
    expect(SolidQueue::ScheduledExecution.joins(:job).where(job: { active_job_id: @job.job_id })).to exist
    allow(AiExecutions::Features).to receive(:state).and_raise(NameError, "programmer defect")
    expect { @job.perform_now }.to raise_error(NameError, "programmer defect")
  end

  it "recovers a real SIGKILLed claimant through the framework prune notification" do
    reader, writer = IO.pipe
    ApplicationRecord.connection_handler.clear_all_connections!
    pid = fork do
      reader.close
      process = SolidQueue::Process.register(kind: "Worker", name: "killed-#{SecureRandom.uuid}", pid: Process.pid, hostname: "test")
      SolidQueue::ReadyExecution.claim([ "ai_executions" ], 1, process.id)
      writer.puts(process.id)
      writer.close
      sleep
    end
    writer.close
    process_id = reader.gets.to_i
    reader.close
    @process_ids << process_id
    Process.kill("KILL", pid)
    Process.wait(pid)
    SolidQueue::Process.find(process_id).update!(last_heartbeat_at: 10.minutes.ago)
    SolidQueue::Process.prune
    expect(SolidQueue::ReadyExecution.joins(:job).where(job: { active_job_id: @job.job_id })).to exist
    expect(AiJobRecovery.find_by!(active_job_id: @job.job_id).recovery_count).to eq(1)
  ensure
    reader&.close unless reader&.closed?
    writer&.close unless writer&.closed?
    if pid
      begin
        Process.kill("KILL", pid) if Process.waitpid(pid, Process::WNOHANG).nil?
      rescue Errno::ECHILD, Errno::ESRCH
        nil
      end
    end
  end
  it "recovers interrupted maintenance with the same persistent infrastructure budget" do
    cleanup = Interviews::CleanupJob.perform_later
    @maintenance_job_ids << cleanup.job_id
    process = SolidQueue::Process.register(kind: "Worker", name: "cleanup-interruption-#{SecureRandom.uuid}", pid: Process.pid, hostname: "test")
    @process_ids << process.id
    4.times do |index|
      claimed = SolidQueue::ReadyExecution.claim([ "maintenance" ], 1, process.id).first
      expect(claimed).to be_present
      claimed.failed_with(SolidQueue::Processes::ProcessMissingError.new)
      AiExecutions::RecoverInterruptedJobsJob.perform_now
      receipt = AiJobRecovery.find_by!(active_job_id: cleanup.job_id)
      expect(receipt.recovery_count).to eq([ index + 1, 3 ].min)
    end
    expect(AiJobRecovery.find_by!(active_job_id: cleanup.job_id).exhausted_at).to be_present
    expect(SolidQueue::FailedExecution.joins(:job).where(job: { active_job_id: cleanup.job_id })).to exist
  end
end
