# Description: Updates a career library certification entry and queues an embedding sync.
# Index:
#   - call: applies the attributes; returns the certification, or validation errors
module Certifications
  class UpdateCertificationService < ApplicationService
    # Receives the authorized owner or record and editable certification attributes.
    def initialize(certification:, attributes:)
      @certification = certification
      @attributes = attributes.to_h.symbolize_keys
      %i[issued_date expiry_date].each do |field|
        precision = :"#{field}_precision"
        @attributes[precision] = "day" if @attributes.key?(field) && !@attributes.key?(precision)
      end
    end

    # Applies the attributes.
    def call
      @certification.assign_attributes(@attributes)
      RecordScreening::InvalidateService.call(record: @certification)
      return failure(@certification.errors) unless @certification.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@certification.user_id)
      success(@certification)
    end
  end
end
