# Description: Background sync of one user's career library embeddings, enqueued by every service
# that changes the library. Runs outside the request so an OpenAI outage never blocks an import or
# edit; temporary OpenAI failures are retried. Enqueued only after the surrounding transaction
# commits, so the sync never reads the library before the change is visible.
# Index:
#   - perform: runs CareerLibrary::SyncLibraryEmbeddingsService (skipped without an API key or user)
module CareerLibrary
  class SyncLibraryEmbeddingsJob < ApplicationJob
    queue_as :default

    self.enqueue_after_transaction_commit = true

    retry_on OpenAI::Errors::APIConnectionError, OpenAI::Errors::RateLimitError,
             OpenAI::Errors::InternalServerError, wait: :polynomially_longer, attempts: 5

    # Syncs the user's embeddings; a deleted user or a missing API key means there's nothing to do.
    def perform(user_id)
      unless Embeddings::OpenAiEmbeddingClient.configured?
        Rails.logger.warn("OPENAI_API_KEY isn't set; skipping career library embedding sync")
        return
      end

      user = User.find_by(id: user_id)
      SyncLibraryEmbeddingsService.call(user: user) if user
    end
  end
end
