# Attach saved legacy work to durable delivery once during deployment/startup.
# This is an explicit, idempotent adoption step, never a recurring work discoverer.
module Interviews
  class BackfillDeliveryService < ApplicationService
    include ExecutionPolicy

    def call
      counts = { dispatched: 0, watchdogs: 0, expired: 0 }
      pending = InterviewSessionOperation.where(status: "pending", delivery_job_id: nil)
      running = InterviewSessionOperation.where(status: "running", recovery_job_id: nil)
      pending.or(running).find_each do |operation|
        @operation = operation
        with_operation_lock do |interview|
          missing = (@operation.pending? && @operation.delivery_job_id.nil?) ||
            (@operation.running? && @operation.recovery_job_id.nil?)
          next unless missing
          if expire_operation(interview)
            counts[:expired] += 1
            next
          end
          if @operation.running?
            ScheduleRecoveryService.call(operation: @operation)
            counts[:watchdogs] += 1
          elsif !@operation.speech? || SpeechPlayback.provider?(interview)
            ScheduleOperationService.call(operation: @operation, nudge: false)
            counts[:dispatched] += 1
          end
        end
      end
      success(counts)
    end
  end
end
