# frozen_string_literal: true

# Description: Merges a duplicate role into another one in the signed-in user's career library.
module Mutations
  module Experiences
    class MergeExperiences < Mutations::BaseMutation
      argument :target_id, ID, required: true, description: "The role that is kept."
      argument :source_id, ID, required: true, description: "The role merged into it, then removed."

      field :experience, Types::ExperienceType, description: "The kept role after merging."

      # Calls CareerLibrary::MergeLibraryRecordsService.
      def resolve(target_id:, source_id:)
        result = ::CareerLibrary::MergeLibraryRecordsService.call(
          target: current_user.experiences.find(target_id), source: current_user.experiences.find(source_id)
        )
        payload_from(result, :experience)
      end
    end
  end
end
