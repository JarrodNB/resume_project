# Description: Adds an education entry to the user's career library and queues an embedding sync.
# Index:
#   - call: saves the education; returns it, or validation errors
module Educations
  class CreateEducationService < ApplicationService
    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes
    end

    # Saves the education.
    def call
      education = @user.educations.new(@attributes)
      return failure(education.errors) unless education.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(education)
    end
  end
end
