# frozen_string_literal: true

# Description: Updates a context in the signed-in user's career library.
module Mutations
  module CareerContexts
    class UpdateCareerContext < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::CareerContextAttributesInput, required: true

      field :career_context, Types::CareerContextType

      # Calls CareerLibrary::SaveLibraryEntryService.
      def resolve(id:, attributes:)
        context = current_user.career_contexts.find(id)
        payload_from(
          ::CareerLibrary::SaveLibraryEntryService.call(user: current_user, kind: :career_context, entry: context, attributes: attributes.to_h),
          :career_context
        )
      end
    end
  end
end
