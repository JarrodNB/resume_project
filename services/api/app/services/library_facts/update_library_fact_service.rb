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
      @library_fact.assign_attributes(@attributes)
      RecordScreening::InvalidateService.call(record: @library_fact)
      return failure(@library_fact.errors) unless @library_fact.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@library_fact.user_id)
      success(@library_fact)
    end
  end
end
