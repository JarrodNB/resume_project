# Description: Adds a certification entry to the user's career library and queues an embedding sync.
# Index:
#   - call: saves the certification; returns it, or validation errors
module Certifications
  class CreateCertificationService < ApplicationService
    # Receives the authorized owner or record and editable certification attributes.
    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes.to_h.symbolize_keys
      %i[issued_date expiry_date].each do |field|
        precision = :"#{field}_precision"
        @attributes[precision] = "day" if @attributes.key?(field) && !@attributes.key?(precision)
      end
    end

    # Saves the certification.
    def call
      certification = @user.certifications.new(@attributes)
      return failure(certification.errors) unless certification.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(certification)
    end
  end
end
