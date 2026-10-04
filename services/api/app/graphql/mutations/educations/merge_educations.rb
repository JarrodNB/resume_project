# frozen_string_literal: true

# Description: Merges a duplicate education entry into another one in the signed-in user's
# career library.
module Mutations
  module Educations
    class MergeEducations < Mutations::BaseMutation
      argument :target_id, ID, required: true, description: "The education entry that is kept."
      argument :source_id, ID, required: true, description: "The entry merged into it, then removed."

      field :education, Types::EducationType, description: "The kept education entry after merging."

      # Calls CareerLibrary::MergeLibraryRecordsService.
      def resolve(target_id:, source_id:)
        result = ::CareerLibrary::MergeLibraryRecordsService.call(
          target: current_user.educations.find(target_id), source: current_user.educations.find(source_id)
        )
        payload_from(result, :education)
      end
    end
  end
end
