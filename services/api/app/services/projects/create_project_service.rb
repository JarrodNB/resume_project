# Description: Adds a project to the user's career library and queues an embedding sync.
# Index:
#   - call: saves the project; returns it, or validation errors
module Projects
  class CreateProjectService < ApplicationService
    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes
    end

    # Saves the project.
    def call
      project = @user.projects.new(@attributes)
      return failure(project.errors) unless project.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(project)
    end
  end
end
