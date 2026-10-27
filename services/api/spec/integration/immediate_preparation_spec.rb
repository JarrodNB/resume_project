# Exercise real domain/queue commits before any cross-process execution nudge.
require "rails_helper"
require "socket"

RSpec.describe "Immediate durable interview preparation" do
  self.use_transactional_tests = false

  around do |example|
    previous = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :solid_queue
    example.run
  ensure
    ActiveJob::Base.queue_adapter = previous
  end

  before do
    @user = create(:user, summary: "I build reliable inventory software.")
    @seen = []
    allow(AiExecutions::NudgeService).to receive(:call) do |feature:, operation_id:|
      @seen << Thread.new do
        ApplicationRecord.connection_pool.with_connection do
          [ feature, InterviewSessionOperation.exists?(operation_id),
            SolidQueue::Job.where(class_name: "AiExecutions::DispatchJob").exists? ]
        end
      end.value
      ServiceResult.new(success: true, value: true, errors: [])
    end
  end

  after do
    operation_ids = @user.interview_sessions.flat_map { |interview| interview.operations.ids }
    operation_ids.each { |id| SolidQueue::Job.where("arguments LIKE ?", "%#{id}%").destroy_all }
    @user.destroy!
  end

  it "commits work and fallback before the immediate nudge can see either" do
    ApplicationRecord.transaction do
      expect(Interviews::StartPreparationService.call(user: @user)).to be_success
      expect(@seen).to be_empty
    end
    expect(@seen).to eq([ [ "interviews", true, true ] ])
  end

  it "leaves no runnable work or nudge after an outer rollback including a released savepoint" do
    ApplicationRecord.transaction do
      ApplicationRecord.transaction(requires_new: true) do
        expect(Interviews::StartPreparationService.call(user: @user)).to be_success
      end
      raise ActiveRecord::Rollback
    end
    expect(@user.interview_sessions.reload).to be_empty
    expect(@seen).to be_empty
  end

  it "rolls back preparation when real fallback insertion fails" do
    connection = ApplicationRecord.connection
    name = "reject_ai_dispatch_probe"
    connection.add_check_constraint(:solid_queue_jobs, "class_name <> 'AiExecutions::DispatchJob'", name: name)
    expect { Interviews::StartPreparationService.call(user: @user) }.to raise_error(SolidQueue::Job::EnqueueError)
    expect(@user.interview_sessions.reload).to be_empty
    expect(@seen).to be_empty
  ensure
    connection.remove_check_constraint(:solid_queue_jobs, name: name) if connection&.check_constraint_exists?(:solid_queue_jobs, name: name)
  end

  it "keeps committed fallback work when the immediate transport fails" do
    allow(AiExecutions::NudgeService).to receive(:call).and_raise(Errno::ECONNREFUSED)
    result = Interviews::StartPreparationService.call(user: @user)
    expect(result).to be_success
    operation = result.value.operations.first
    expect(SolidQueue::Job.find_by!(active_job_id: operation.delivery_job_id)).to be_present
  end

  it "backs a successful claim and each renewal with matching durable recovery" do
    operation = Interviews::StartPreparationService.call(user: @user).value.operations.first
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
    operation.reload
    original = operation.recovery_job_id
    expect(SolidQueue::Job.find_by!(active_job_id: original).class_name).to eq("AiExecutions::RecoveryJob")
    expect(Interviews::DeliveryStateService.call(operation: operation).value.fetch(:delivered)).to be(true)
    travel 2.seconds
    expect(Interviews::RenewClaimService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation)).to be_success
    expect(operation.reload.recovery_job_id).not_to eq(original)
  end

  it "sends a real HTTP nudge after commit while no queue consumer runs" do
    server = TCPServer.new("127.0.0.1", 0)
    original_origin = ENV["AI_HTTP_ORIGIN"]
    original_secret = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["AI_HTTP_ORIGIN"] = "http://127.0.0.1:#{server.addr[1]}"
    ENV["INTERVIEW_SERVICE_SECRET"] = "execution-http-test"
    allow(AiExecutions::NudgeService).to receive(:call).and_call_original
    received = Thread.new do
      socket = server.accept
      headers = +""
      headers << socket.gets until headers.end_with?("\r\n\r\n")
      body = socket.read(headers[/content-length: (\d+)/i, 1].to_i)
      operation_id = JSON.parse(body).fetch("operation_id")
      visible = ApplicationRecord.connection_pool.with_connection do
        [ InterviewSessionOperation.exists?(operation_id),
          SolidQueue::Job.where(class_name: "AiExecutions::DispatchJob").exists? ]
      end
      socket.write("HTTP/1.1 202 Accepted\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
      socket.close
      [ headers, visible ]
    end
    expect(Interviews::StartPreparationService.call(user: @user)).to be_success
    headers, visible = received.value
    expect(headers).to include("POST /internal/executions", "Bearer execution-http-test")
    expect(visible).to eq([ true, true ])
    expect(@user.interview_sessions.first.operations.first).to be_pending
  ensure
    ENV["AI_HTTP_ORIGIN"] = original_origin
    ENV["INTERVIEW_SERVICE_SECRET"] = original_secret
    server&.close
    received&.kill if received&.alive?
  end

  it "recovers only the latest expired watchdog and retains the execution usage identity" do
    operation = Interviews::StartPreparationService.call(user: @user).value.operations.first
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
    first = SolidQueue::Job.find_by!(active_job_id: operation.reload.recovery_job_id)
    stale = AiExecutions::RecoveryJob.new(*first.arguments.fetch("arguments"))
    stale.job_id = first.active_job_id
    travel 2.seconds
    expect(Interviews::RenewClaimService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation)).to be_success
    latest = SolidQueue::Job.find_by!(active_job_id: operation.reload.recovery_job_id)
    current = AiExecutions::RecoveryJob.new(*latest.arguments.fetch("arguments"))
    current.job_id = latest.active_job_id
    travel 31.seconds
    stale.perform_now
    expect(operation.reload).to be_running
    current.perform_now
    expect(operation.reload).to have_attributes(status: "pending", failure_code: "lease_expired", execution_count: 1)
    expect(operation.ai_task.ai_usage_attempts.count).to eq(1)
    expect(SolidQueue::Job.find_by!(active_job_id: operation.delivery_job_id).class_name).to eq("AiExecutions::DispatchJob")
  end

  it "rearms an early current watchdog instead of dropping the recovery intent" do
    operation = Interviews::StartPreparationService.call(user: @user).value.operations.first
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
    stored = SolidQueue::Job.find_by!(active_job_id: operation.reload.recovery_job_id)
    early = AiExecutions::RecoveryJob.new(*stored.arguments.fetch("arguments"))
    early.job_id = stored.active_job_id
    early.perform_now
    replacement = SolidQueue::Job.find_by!(active_job_id: operation.reload.recovery_job_id)
    expect(replacement.active_job_id).not_to eq(stored.active_job_id)
    expect(replacement.scheduled_execution).to be_present
    current = AiExecutions::RecoveryJob.new(*replacement.arguments.fetch("arguments"))
    current.job_id = replacement.active_job_id
    travel 31.seconds
    current.perform_now
    expect(operation.reload).to have_attributes(status: "pending", failure_code: "lease_expired")
  end
end
