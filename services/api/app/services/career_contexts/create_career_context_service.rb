# Description: Adds a context to the user's career library and queues an embedding sync.
# Index:
#   - call: saves the context; returns it, or validation errors
module CareerContexts
  class CreateCareerContextService < ApplicationService
    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes
    end

    # Saves the context.
    def call
      context = @user.career_contexts.new(@attributes)
      return failure(context.errors) unless context.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(context)
    end
  end
end
