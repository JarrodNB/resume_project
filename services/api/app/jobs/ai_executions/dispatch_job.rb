# Retry a specific committed command until the owner confirms durable execution.
# Explicit executor capacity pressure waits under owner expiry, outside the bounded
# transport/lost-claim retry budget. Every retry retains the exact delivery fence.
module AiExecutions
  class DispatchJob < DurableJob
    class DeliveryPending < StandardError; end
    retry_on DeliveryPending, wait: 1.second, attempts: 30 do |job, _error|
      job.stop_delivery
    end

    def perform(feature, operation_id)
      state = Features.state(feature, operation_id, delivery_job_id: job_id)
      return if state.fetch(:delivered)
      if state[:retry_at] && state[:retry_at] > Time.current
        retry_job(wait_until: state[:retry_at])
        return
      end
      result = NudgeService.call(feature: feature, operation_id: operation_id)
      return if Features.state(feature, operation_id, delivery_job_id: job_id).fetch(:delivered)

      if result.success? && result.value == :busy
        retry_job(wait: 1.second)
      else
        raise DeliveryPending, "AI execution delivery pending"
      end
    end

    def stop_delivery
      Features.stop(*arguments, delivery_job_id: job_id)
    end
  end
end
