# Description: Embeds one saved interview Q&A after commit without blocking answer saving.
# Index:
#   - perform: skips missing configuration or deleted owners, then synchronizes one question
module InterviewPrep
  class SyncQuestionEmbeddingJob < ApplicationJob
    queue_as :default
    self.enqueue_after_transaction_commit = true

    retry_on OpenAI::Errors::APIConnectionError, OpenAI::Errors::RateLimitError,
             OpenAI::Errors::InternalServerError, wait: :polynomially_longer, attempts: 5

    # Resolves ownership again; missing configuration leaves answers and cleanup unchanged.
    def perform(user_id, question_id)
      unless Embeddings::OpenAiEmbeddingClient.configured?
        Rails.logger.warn("OPENAI_API_KEY isn't set; skipping interview Q&A embedding sync")
        return
      end
      user = User.find_by(id: user_id)
      SyncQuestionEmbeddingService.call(user: user, question_id: question_id) if user
    end
  end
end
