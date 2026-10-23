# Description: Destroys a record the caller has already authorized (looked up via current_user).
# Deleting a career library entry queues an embedding sync, which removes its embeddings.
# Index:
#   - LIBRARY_MODELS: career library models whose deletion re-syncs embeddings
#   - call: destroys the record; returns it on success, errors on failure
module Records
  class DestroyRecordService < ApplicationService
    LIBRARY_MODELS = [ Experience, Project, Education, Certification, Skill, LibraryFact ].freeze

    def initialize(record:)
      @record = record
    end

    # Reloads under its row lock so cached children cannot hide recently added bullets.
    def call
      @record.with_lock do
        return failure(@record.errors) unless @record.destroy
      end

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@record.user_id) if LIBRARY_MODELS.include?(@record.class)
      success(@record)
    end
  end
end
