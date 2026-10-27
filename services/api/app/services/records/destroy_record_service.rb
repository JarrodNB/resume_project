# Description: Destroys a record the caller has already authorized (looked up via current_user).
# Deleting a career library entry queues an embedding sync, which removes its embeddings.
# Job deletion detaches retained interviews through normal callbacks so live navigation refreshes.
# Index:
#   - LIBRARY_MODELS: career library models whose deletion re-syncs embeddings
#   - call: destroys the record; returns it on success, errors on failure
module Records
  class DestroyRecordService < ApplicationService
    LIBRARY_MODELS = [ Experience, Project, Education, Certification, Skill, LibraryFact ].freeze

    def initialize(record:)
      @record = record
    end

    # Destroys the record.
    def call
      destroyed = if @record.is_a?(Job)
        @record.user.with_lock do
          @record.lock!
          @record.interview_sessions.where("expires_at > ?", Time.current).where(content_purged_at: nil).find_each do |interview|
            interview.update!(job: nil)
          end
          result = @record.destroy
          raise ActiveRecord::Rollback unless result
          result
        end
      else
        @record.destroy
      end
      return failure(@record.errors) unless destroyed

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@record.user_id) if LIBRARY_MODELS.include?(@record.class)
      success(@record)
    end
  end
end
