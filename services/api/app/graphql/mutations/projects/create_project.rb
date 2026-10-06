# frozen_string_literal: true

# Description: Adds a project to the signed-in user's career library.
module Mutations
  module Projects
    class CreateProject < Mutations::BaseMutation
      argument :attributes, Types::ProjectAttributesInput, required: true

      field :project, Types::ProjectType

      # Calls Projects::CreateProjectService.
      def resolve(attributes:)
        payload_from(::Projects::CreateProjectService.call(user: current_user, attributes: attributes.to_h), :project)
      end
    end
  end
end
