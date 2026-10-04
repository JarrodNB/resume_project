# frozen_string_literal: true

# Description: Removes a project from the signed-in user's career library.
module Mutations
  module Projects
    class DeleteProject < Mutations::BaseMutation
      argument :id, ID, required: true

      field :project, Types::ProjectType

      # Calls Records::DestroyRecordService.
      def resolve(id:)
        project = current_user.projects.find(id)
        payload_from(::Records::DestroyRecordService.call(record: project), :project)
      end
    end
  end
end
