# Description: Adds a fact to the user's career library and queues an embedding sync.
# Index:
#   - call: saves the fact; returns it, or validation errors
module LibraryFacts
  class CreateLibraryFactService < ApplicationService
    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes
    end

    # Saves the fact.
    def call
      fact = @user.library_facts.new(@attributes)
      return failure(fact.errors) unless fact.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(fact)
    end
  end
end
