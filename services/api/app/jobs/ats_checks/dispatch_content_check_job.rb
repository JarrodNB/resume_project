# Bounded retries deliver persisted scheduling work without creating another AI task.
module AtsChecks
  class DispatchContentCheckJob < ApplicationJob
    retry_on Aws::SQS::Errors::ServiceError, Seahorse::Client::NetworkingError,
             wait: :polynomially_longer, attempts: 5 do |job, error|
      run = AtsCheckRun.find_by(id: job.arguments.first)
      AtsChecks::FailContentDispatchService.call(run: run) if run
      Rails.logger.error("ATS dispatch exhausted retries: #{error.class}")
    end

    def perform(run_id)
      run = AtsCheckRun.find_by(id: run_id)
      AtsChecks::DispatchContentCheckService.call(run: run) if run
    end
  end
end
