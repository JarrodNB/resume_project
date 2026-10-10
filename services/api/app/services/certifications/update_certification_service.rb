# Description: Updates a career library certification entry and queues an embedding sync.
# Index:
#   - call: applies the attributes; returns the certification, or validation errors
module Certifications
  class UpdateCertificationService < ApplicationService
    # Receives the authorized owner or record and editable certification attributes.
    def initialize(certification:, attributes:)
      @certification = certification
      @attributes = attributes
    end

    # Applies the attributes.
    def call
      return failure(@certification.errors) unless @certification.update(@attributes)

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@certification.user_id)
      success(@certification)
    end
  end
end
