# Saturated executors leave admitted work durable until a slot or owner expiry.
# Real queue round trips preserve retry accounting; no model/provider runs here.
require "rails_helper"

RSpec.describe "AI execution capacity backpressure" do
  self.use_transactional_tests = false

  around do |example|
    previous = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :solid_queue
    example.run
  ensure
    ActiveJob::Base.queue_adapter = previous
  end

  before do
    freeze_time
    @users = []
    @operations = []
    3.times do
      user = create(:user, email: "capacity-#{SecureRandom.uuid}@example.test", summary: "I maintain inventory systems.")
      @users << user
      result = Interviews::StartPreparationService.call(user: user)
      expect(result).to be_success
      @operations << result.value.operations.first
    end
    @occupied = @operations.first(2)
    @occupied.each do |operation|
      expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
    end
    @waiting = @operations.last
    @worker = SolidQueue::Process.register(kind: "Worker", name: "capacity-#{SecureRandom.uuid}", pid: Process.pid, hostname: "test")
    allow(AiExecutions::NudgeService).to receive(:call) do |feature:, operation_id:|
      expect(feature).to eq("interviews")
      if @occupied.size >= 2
        ServiceResult.new(success: true, value: :busy, errors: [])
      else
        operation = InterviewSessionOperation.find(operation_id)
        expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
        @occupied << operation
        ServiceResult.new(success: true, value: :accepted, errors: [])
      end
    end
  end

  after do
    @operations.each { |operation| SolidQueue::Job.where("arguments LIKE ?", "%#{operation.id}%").destroy_all }
    @worker&.deregister
    @users.each { |user| user.reload.destroy! }
  end

  def perform_delivery(delivery_job_id: @waiting.reload.delivery_job_id)
    stored = SolidQueue::Job.where(active_job_id: delivery_job_id).where(finished_at: nil).order(:id).last!
    expect(stored.scheduled_execution).to be_present
    travel_to stored.scheduled_execution.scheduled_at, with_usec: true
    SolidQueue::ScheduledExecution.dispatch_next_batch(100)
    loop do
      execution = SolidQueue::ReadyExecution.claim([ "ai_executions" ], 1, @worker.id).first
      expect(execution).to be_present
      serialized = execution.job.arguments
      target = execution.job_id == stored.id
      execution.perform
      return serialized if target
    end
  end

  def keep_capacity_busy(count)
    count.times do |index|
      renew_occupied_leases if index % 10 == 0
      perform_delivery
      expect(@waiting.reload).to have_attributes(status: "pending", execution_count: 0, failure_code: nil)
      expect(@waiting.ai_task.ai_usage_attempts).to be_empty
    end
  end

  def renew_occupied_leases
    @occupied.each do |operation|
      expect(Interviews::RenewClaimService.call(operation: operation, attempt_id: operation.attempt_id,
        claim_generation: operation.claim_generation)).to be_success
    end
  end

  def expect_delivery_finished(delivery_job_id: @waiting.delivery_job_id)
    expect(SolidQueue::Job.where(active_job_id: delivery_job_id, finished_at: nil)).not_to exist
  end

  it "claims the third owner's work after more than thirty seconds of healthy capacity pressure" do
    delivery_id = @waiting.delivery_job_id
    usage_ids = @occupied.map { |operation| operation.ai_task.ai_usage_attempts.sole.id }
    keep_capacity_busy(35)
    expect(@waiting.reload.delivery_job_id).to eq(delivery_id)
    expect(@occupied.map { |operation| operation.ai_task.ai_usage_attempts.sole.id }).to eq(usage_ids)

    released = @occupied.shift
    role = { "title" => "Inventory engineer", "responsibilities" => [ "Maintain inventory" ], "requirements" => [ "Reliable systems" ] }
    questions = Interviews::SetupConfiguration.question_types(released.interview_session).each_with_index.map do |type, index|
      { "question_type" => type, "content" => "Describe inventory topic #{index}?" }
    end
    expect(Interviews::AcceptPreparationService.call(operation: released, attempt_id: released.attempt_id,
      claim_generation: released.claim_generation, role: role, questions: questions)).to be_success
    duplicate = perform_delivery
    expect(@waiting.reload).to have_attributes(status: "running", execution_count: 1, claim_generation: 1)
    expect(@waiting.ai_task.ai_usage_attempts.count).to eq(1)
    expect(SolidQueue::Job.find_by!(active_job_id: @waiting.recovery_job_id).scheduled_execution).to be_present

    2.times { ActiveJob::Base.execute(duplicate) }
    expect(@waiting.reload.execution_count).to eq(1)
    expect(@waiting.ai_task.ai_usage_attempts.count).to eq(1)
    expect(released.ai_task.ai_usage_attempts.sole.id).to eq(usage_ids.first)
    expect(released.ai_task.ai_usage_attempts.sole).not_to be_finalized
  end

  it "stops repeated capacity retries when the owning interview expires" do
    keep_capacity_busy(35)
    @waiting.interview_session.update!(expires_at: 1.second.from_now)
    expect(AiExecutions::NudgeService).not_to receive(:call)
    perform_delivery
    expect(@waiting.reload).to have_attributes(status: "expired", execution_count: 0)
    expect(@waiting.ai_task.ai_usage_attempts).to be_empty
    expect_delivery_finished
  end

  it "stops repeated capacity retries when the owner abandons the interview" do
    keep_capacity_busy(35)
    expect(Interviews::AbandonService.call(interview: @waiting.interview_session)).to be_success
    expect(AiExecutions::NudgeService).not_to receive(:call)
    perform_delivery
    expect(@waiting.reload).to have_attributes(status: "expired", execution_count: 0, failure_code: "interview_abandoned")
    expect(@waiting.ai_task.ai_usage_attempts).to be_empty
    expect_delivery_finished
  end

  it "finishes a superseded busy delivery without stopping the newer pending delivery" do
    keep_capacity_busy(35)
    old_id = @waiting.delivery_job_id
    expect(Interviews::ScheduleOperationService.call(operation: @waiting, nudge: false)).to be_success
    new_id = @waiting.reload.delivery_job_id
    expect(new_id).not_to eq(old_id)
    expect(AiExecutions::NudgeService).not_to receive(:call)
    perform_delivery(delivery_job_id: old_id)
    expect(@waiting.reload).to have_attributes(status: "pending", execution_count: 0, delivery_job_id: new_id)
    expect_delivery_finished(delivery_job_id: old_id)
    expect(SolidQueue::Job.find_by!(active_job_id: new_id).ready_execution).to be_present
  end

  it "observes a replacement delivery committed while a busy nudge is in flight" do
    old_id = @waiting.delivery_job_id
    allow(AiExecutions::NudgeService).to receive(:call) do
      expect(Interviews::ScheduleOperationService.call(operation: @waiting, nudge: false)).to be_success
      ServiceResult.new(success: true, value: :busy, errors: [])
    end
    perform_delivery
    expect(@waiting.reload).to have_attributes(status: "pending", execution_count: 0)
    expect(@waiting.delivery_job_id).not_to eq(old_id)
    expect_delivery_finished(delivery_job_id: old_id)
    expect(SolidQueue::Job.find_by!(active_job_id: @waiting.delivery_job_id).scheduled_execution).to be_present
  end

  {
    "transport unavailable" => ServiceResult.new(success: false, value: nil, errors: [ "AI execution unavailable" ]),
    "HTTP202 without a durable claim" => ServiceResult.new(success: true, value: :accepted, errors: [])
  }.each do |description, result|
    it "retains exactly thirty #{description} retries across repeated busy reschedules" do
      keep_capacity_busy(35)
      allow(AiExecutions::NudgeService).to receive(:call).and_return(result)
      keep_capacity_busy(15)
      allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: :busy, errors: []))
      keep_capacity_busy(5)
      allow(AiExecutions::NudgeService).to receive(:call).and_return(result)
      keep_capacity_busy(14)
      perform_delivery
      expect(@waiting.reload).to have_attributes(status: "failed", failure_code: "dependency_unavailable", execution_count: 0)
      expect(@waiting.ai_task.ai_usage_attempts).to be_empty
      expect_delivery_finished
    end
  end
end
