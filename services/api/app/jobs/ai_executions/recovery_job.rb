# Apply one exact-operation lease/deadline check; stale jobs are harmless receipts.
module AiExecutions
  class RecoveryJob < DurableJob
    def perform(feature, operation_id, attempt_id, generation, expected_at)
      Features.recover(feature, operation_id, attempt_id: attempt_id, generation: generation,
        expected_at: expected_at, job_id: job_id)
    end

    def stop_delivery
      Features.stop(*arguments.first(2), attempt_id: arguments[2], generation: arguments[3], recovery_job_id: job_id)
    end
  end
end
