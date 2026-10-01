# Description: SQS client for Shoryuken. Points at ElasticMQ locally when SQS_ENDPOINT_URL is
# set; on AWS the endpoint is omitted and credentials come from the environment/IAM role.
# Index:
#   - AI_TASKS_QUEUE_NAME: queue the AI worker consumes (published by AiTasks::EnqueueAiTaskService)
#   - AI_RESULTS_QUEUE_NAME: queue AiResultWorker consumes
#   - configure_server: loads app/workers so Shoryuken can find them
AI_TASKS_QUEUE_NAME = ENV.fetch("AI_TASKS_QUEUE_NAME", "ai_tasks")
AI_RESULTS_QUEUE_NAME = ENV.fetch("AI_RESULTS_QUEUE_NAME", "ai_results")

Shoryuken.sqs_client = Aws::SQS::Client.new(
  region: ENV.fetch("AWS_REGION", "us-east-1"),
  **{ endpoint: ENV["SQS_ENDPOINT_URL"].presence }.compact
)

# Workers register themselves when their class loads, and development doesn't eager load.
# Code reloading doesn't reach the Shoryuken process: restart it after editing a worker.
Shoryuken.configure_server do
  Rails.application.config.after_initialize do
    Rails.autoloaders.main.eager_load_dir(Rails.root.join("app/workers"))
  end
end
