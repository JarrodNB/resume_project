# frozen_string_literal: true

# Description: Merges a duplicate certification entry into another one in the signed-in user's
# career library.
# Index: resolve delegates the authorized lifecycle operation
module Mutations
  module Certifications
    class MergeCertifications < Mutations::BaseMutation
      argument :target_id, ID, required: true, description: "The certification entry that is kept."
      argument :source_id, ID, required: true, description: "The entry merged into it, then removed."

      field :certification, Types::CertificationType, description: "The kept certification entry after merging."

      # Calls CareerLibrary::MergeLibraryRecordsService.
      def resolve(target_id:, source_id:)
        result = ::CareerLibrary::MergeLibraryRecordsService.call(
          target: current_user.certifications.find(target_id), source: current_user.certifications.find(source_id)
        )
        payload_from(result, :certification)
      end
    end
  end
end
