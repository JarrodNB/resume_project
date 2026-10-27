# Retry a specific committed command until the owner confirms durable execution.
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
      NudgeService.call(feature: feature, operation_id: operation_id)
      raise DeliveryPending, "AI execution delivery pending" unless Features.state(feature, operation_id, delivery_job_id: job_id).fetch(:delivered)
    end

    def stop_delivery
      Features.stop(*arguments, delivery_job_id: job_id)
    end
  end
end
