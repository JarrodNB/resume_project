# Description: Shoryuken worker for the ai_results queue (runs in the api-results-worker service).
# A rejected message raises, so SQS redelivers it and moves it to ai_results_dead_letters after
# 3 attempts; the message is deleted only after it was applied or ignored as a duplicate.
# Index:
#   - perform: applies one result message via AiTasks::ApplyAiResultService
class AiResultWorker
  include Shoryuken::Worker

  shoryuken_options queue: AI_RESULTS_QUEUE_NAME, auto_delete: true, body_parser: :json

  # Applies the parsed result message, raising if it was rejected.
  def perform(_sqs_message, body)
    result = AiTasks::ApplyAiResultService.call(message: body)
    raise ArgumentError, "Rejected AI result: #{result.errors.to_sentence}" unless result.success?
  end
end
