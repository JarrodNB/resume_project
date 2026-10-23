# Reloads under the row lock so concurrent screening approvals cannot outlive an edit.
# Description: Updates a career library project and queues an embedding sync.
# Index:
#   - call: applies the attributes; returns the project, or validation errors
module Projects
  class UpdateProjectService < ApplicationService
    def initialize(project:, attributes:)
      @project = project
      @attributes = attributes
    end

    # Applies the attributes.
    def call
      saved = @project.with_lock do
        @project.assign_attributes(@attributes)
        CareerLibrary::RecordScreeningService.discard_changed_fields(record: @project)
        @project.save
      end
      return failure(@project.errors) unless saved

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@project.user_id)
      success(@project)
    end
  end
end
