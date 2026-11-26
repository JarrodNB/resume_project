# One place for the leased, fenced life of an AI operation claimed by the Python runtime.
#
# Chat and interviews both hand work to Python over internal HTTP: Rails reserves an
# attempt (lease + deadline + attempt id + claim generation), Python renews it, and the
# attempt ends with a result, a failure or an expired lease. This class owns those rules
# for both features: lock order, fencing, lease expiry, retry budgets, failure handling
# and the delivery/recovery jobs. Each feature's `AiExecutions::OperationPolicy` supplies
# only what differs. No provider or storage I/O may happen inside `with_lock`.
module AiExecutions
  class OperationLifecycle
    LEASE = 30.seconds
    DEADLINE = 120.seconds
    BACKOFF = [ 2, 5, 10 ].freeze
    MAX_CYCLE_EXECUTIONS = 3
    MAX_EXECUTIONS = 6

    attr_reader :operation, :policy

    def self.for(operation)
      new(operation, Features.policy(operation))
    end

    def initialize(operation, policy)
      @operation, @policy = operation, policy
    end

    # Owner lock first, then feature rows, the operation and its task.
    def with_lock
      owner = policy.owner
      owner.user.with_lock(requires_new: true) do
        owner.lock!
        policy.lock_owner_records(owner)
        operation.lock!
        operation.ai_task&.lock!
        yield owner
      end
    end

    # A lease only counts when it is the exact running attempt and nothing has expired.
    def current_claim?(attempt_id, generation)
      operation.running? && attempt_id.present? && operation.attempt_id == attempt_id &&
        operation.claim_generation == generation && lease_active? && policy.claim_allowed?
    end

    def lease_active?
      operation.lease_expires_at.present? && operation.lease_expires_at > Time.current &&
        operation.execution_deadline > Time.current
    end

    def retry_window_open?
      operation.retry_expires_at.present? && operation.retry_expires_at > Time.current
    end

    # True when one more automatic attempt in this cycle is allowed.
    def automatic_retry_allowed?
      operation.cycle_execution_count < MAX_CYCLE_EXECUTIONS && operation.execution_count < MAX_EXECUTIONS &&
        retry_window_open?
    end

    def executions_exhausted?
      operation.execution_count >= MAX_EXECUTIONS || operation.cycle_execution_count >= MAX_CYCLE_EXECUTIONS
    end

    # An explicit retry may start another cycle while the total budget lasts.
    def total_budget_left?
      operation.execution_count < MAX_EXECUTIONS
    end

    def pending_and_due?
      operation.pending? && (!operation.retry_at || operation.retry_at <= Time.current)
    end

    # If a claim finds a running attempt, returns the error message to report (after recovering
    # an expired one). Returns nil when the operation is not running.
    def running_claim_error
      return unless operation.running?
      return "Operation already claimed" if lease_active?

      fail_execution(policy.stale_claim_code, retryable: true)
      "Recovery scheduled"
    end

    # Record a failure: retry later when allowed, otherwise end the operation and its task.
    def fail_execution(code, retryable:)
      automatic = retryable && automatic_retry_allowed?
      operation.update!(status: automatic ? "pending" : "failed", failure_code: code,
        retry_at: automatic ? Time.current + BACKOFF.fetch([ operation.cycle_execution_count - 1, 0 ].max).seconds : nil)
      schedule if automatic
      if operation.ai_task
        AiTasks::UpdateTaskService.call(task: operation.ai_task, attributes: { status: automatic ? "queued" : "failed",
          completed_at: automatic ? nil : Time.current, error_message: code })
      end
      policy.after_failure(code, retryable: retryable, automatic: automatic)
    end

    # Start a new attempt: bump the fence, record the attempt, arm the watchdog and the
    # unknown-cost marker. Returns the new attempt id.
    def reserve_attempt!(**extra_attributes)
      attempt_id = SecureRandom.uuid
      operation.update!(status: "running", attempt_id: attempt_id, claim_generation: operation.claim_generation + 1,
        execution_count: operation.execution_count + 1, cycle_execution_count: operation.cycle_execution_count + 1,
        lease_expires_at: LEASE.from_now, execution_deadline: DEADLINE.from_now, retry_at: nil, failure_code: nil,
        **extra_attributes)
      operation.execution_attempts.create!(attempt_id: attempt_id, claim_generation: operation.claim_generation)
      schedule_recovery
      AiTasks::RecordAttemptUsageService.call(ai_task: operation.ai_task,
        message: { "attempt_id" => attempt_id, "attempt_finished" => false })
      operation.ai_task.update!(status: "queued", completed_at: nil, error_message: nil)
      attempt_id
    end

    # Open a new retry cycle for failed work and queue its delivery.
    def reopen_for_retry!(retry_at:)
      operation.update!(status: "pending", cycle_execution_count: 0, retry_at: retry_at, failure_code: nil)
      operation.ai_task&.update!(status: "queued", completed_at: nil, error_message: nil)
      schedule
    end

    # Save the delivery intent with the operation; optionally nudge FastAPI after commit.
    def schedule(nudge: true)
      at = operation.retry_at || Time.current
      job = DispatchJob.new(policy.feature, operation.id)
      job.enqueue(wait_until: at > Time.current ? at : 1.second.from_now)
      raise ActiveJob::EnqueueError, "AI dispatch enqueue failed" unless job.successfully_enqueued?

      operation.update!(delivery_job_id: job.job_id)
      if nudge && at <= Time.current
        feature, id = policy.feature, operation.id
        ActiveRecord.after_all_transactions_commit do
          NudgeService.call(feature: feature, operation_id: id)
        rescue StandardError
          # The committed dispatch job still runs if the nudge fails after commit.
          Rails.logger.warn("AI execution immediate nudge unavailable; durable delivery retained")
        end
      end
      job.job_id
    end

    # Save the exact watchdog job identity beside the fenced lease.
    def schedule_recovery
      at = [ operation.lease_expires_at, operation.execution_deadline ].min
      job = RecoveryJob.new(policy.feature, operation.id, operation.attempt_id, operation.claim_generation, at.iso8601(6))
      job.enqueue(wait_until: at)
      raise ActiveJob::EnqueueError, "AI recovery enqueue failed" unless job.successfully_enqueued?

      operation.update!(recovery_job_id: job.job_id)
      job.job_id
    end
  end
end
