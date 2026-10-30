# Reloads under the row lock so concurrent screening approvals cannot outlive an edit.
# Description: Updates a career library education entry and queues an embedding sync.
# Index:
#   - call: applies the attributes; returns the education, or validation errors
module Educations
  class UpdateEducationService < ApplicationService
    def initialize(education:, attributes:)
      @education = education
      @attributes = attributes
    end

    # Applies the attributes.
    def call
      saved = @education.with_lock do
        @education.assign_attributes(@attributes)
        @education.discard_changed_screened_fields
        @education.save
      end
      return failure(@education.errors) unless saved

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@education.user_id)
      success(@education)
    end
  end
end
