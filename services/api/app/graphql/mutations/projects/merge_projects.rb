# frozen_string_literal: true

# Description: Merges a duplicate project into another one in the signed-in user's career library.
module Mutations
  module Projects
    class MergeProjects < Mutations::BaseMutation
      argument :target_id, ID, required: true, description: "The project that is kept."
      argument :source_id, ID, required: true, description: "The project merged into it, then removed."

      field :project, Types::ProjectType, description: "The kept project after merging."

      # Calls CareerLibrary::MergeLibraryRecordsService.
      def resolve(target_id:, source_id:)
        result = ::CareerLibrary::MergeLibraryRecordsService.call(
          target: current_user.projects.find(target_id), source: current_user.projects.find(source_id)
        )
        payload_from(result, :project)
      end
    end
  end
end
