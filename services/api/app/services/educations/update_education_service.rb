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
      return failure(@education.errors) unless @education.update(@attributes)

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@education.user_id)
      success(@education)
    end
  end
end
