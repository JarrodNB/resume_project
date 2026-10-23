# Reloads under the row lock so concurrent screening approvals cannot outlive an edit.
# Description: Updates a career library fact and queues an embedding sync.
# Index:
#   - call: applies the attributes; returns the fact, or validation errors
module LibraryFacts
  class UpdateLibraryFactService < ApplicationService
    def initialize(library_fact:, attributes:)
      @library_fact = library_fact
      @attributes = attributes
    end

    # Applies the attributes.
    def call
      saved = @library_fact.with_lock do
        @library_fact.assign_attributes(@attributes)
        CareerLibrary::RecordScreeningService.discard_changed_fields(record: @library_fact)
        @library_fact.save
      end
      return failure(@library_fact.errors) unless saved

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@library_fact.user_id)
      success(@library_fact)
    end
  end
end
