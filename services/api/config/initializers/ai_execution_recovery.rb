# Framework process-death hooks speed up bounded recovery; recurring reconciliation
# also finds committed failed rows if a hook itself crashes after that commit.
SolidQueue.process_heartbeat_interval = 5.seconds
SolidQueue.process_alive_threshold = 30.seconds

ActiveSupport::Notifications.subscribe("fail_many_claimed.solid_queue") do |event|
  Rails.application.executor.wrap do
    AiExecutions::RecoverInterruptedJobsService.call(job_ids: event.payload[:job_ids])
  end
rescue StandardError => error
  Rails.logger.warn("AI queue recovery deferred (#{error.class.name})")
end

SolidQueue.on_start do
  Rails.application.executor.wrap { AiExecutions::RecoverInterruptedJobsService.call }
end
