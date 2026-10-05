# Description: Destroys a record the caller has already authorized (looked up via current_user).
# Deleting a career library entry queues an embedding sync, which removes its embeddings.
# Index:
#   - LIBRARY_MODELS: career library models whose deletion re-syncs embeddings
#   - call: destroys the record; returns it on success, errors on failure
module Records
  class DestroyRecordService < ApplicationService
    LIBRARY_MODELS = [ Experience, Project, Education, Skill ].freeze

    def initialize(record:)
      @record = record
    end

    # Destroys the record.
    def call
      return failure(@record.errors) unless @record.destroy

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@record.user_id) if LIBRARY_MODELS.include?(@record.class)
      success(@record)
    end
  end
end
