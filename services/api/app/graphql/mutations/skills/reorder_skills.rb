# frozen_string_literal: true

# Description: Saves a new order for the signed-in user's skills.
module Mutations
  module Skills
    class ReorderSkills < Mutations::BaseMutation
      argument :ordered_ids, [ ID ], required: true, description: "Every skill id, in the new order."

      # Calls CareerLibrary::ReorderLibraryEntriesService with the user's skills.
      def resolve(ordered_ids:)
        result = ::CareerLibrary::ReorderLibraryEntriesService.call(records: current_user.skills, ordered_ids: ordered_ids)
        { errors: result.errors }
      end
    end
  end
end
