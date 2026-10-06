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
      return failure(@project.errors) unless @project.update(@attributes)

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@project.user_id)
      success(@project)
    end
  end
end
