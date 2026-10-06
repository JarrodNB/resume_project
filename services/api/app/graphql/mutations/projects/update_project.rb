# frozen_string_literal: true

# Description: Updates a project in the signed-in user's career library.
module Mutations
  module Projects
    class UpdateProject < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::ProjectAttributesInput, required: true

      field :project, Types::ProjectType

      # Calls Projects::UpdateProjectService.
      def resolve(id:, attributes:)
        project = current_user.projects.find(id)
        payload_from(::Projects::UpdateProjectService.call(project: project, attributes: attributes.to_h), :project)
      end
    end
  end
end
