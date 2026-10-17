# Bounded retries deliver persisted scheduling work without creating another AI task.
module AtsChecks
  class DispatchContentCheckJob < ApplicationJob
    retry_on Aws::SQS::Errors::ServiceError, Seahorse::Client::NetworkingError,
             wait: :polynomially_longer, attempts: 5 do |job, error|
      run = AtsCheckRun.find_by(id: job.arguments.first)
      if run
        run.user.with_lock do
          task = run.reload.ai_task
          if task
            task.with_lock do
              run.with_lock do
                if %w[pending queued].include?(run.status) && !task.finished?
                  task.update!(status: "failed", error_message: "Could not queue the check.", completed_at: Time.current)
                  run.update!(status: "failed", error_message: "Could not queue the check. Please retry.")
                end
              end
            end
          else
            run.with_lock { run.update!(status: "failed", error_message: "Could not queue the check. Please retry.") if run.status == "pending" }
          end
        end
      end
      AtsChecks::NotifyReportService.call(resume: run.resume) if run
      Rails.logger.error("ATS dispatch exhausted retries: #{error.class}")
    end

    def perform(run_id)
      run = AtsCheckRun.find_by(id: run_id)
      AtsChecks::DispatchContentCheckService.call(run: run) if run
    end
  end
end
