# Reloads under the row lock so concurrent screening approvals cannot outlive an edit.
# Description: Updates a career career context and queues an embedding sync.
# Index:
#   - call: applies the attributes; returns the context, or validation errors
module CareerContexts
  class UpdateCareerContextService < ApplicationService
    def initialize(career_context:, attributes:)
      @career_context = career_context
      @attributes = attributes
    end

    # Applies the attributes.
    def call
      saved = @career_context.with_lock do
        @career_context.assign_attributes(@attributes)
        @career_context.discard_changed_screened_fields
        @career_context.save
      end
      return failure(@career_context.errors) unless saved

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@career_context.user_id)
      success(@career_context)
    end
  end
end
