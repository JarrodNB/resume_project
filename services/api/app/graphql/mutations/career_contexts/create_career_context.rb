# frozen_string_literal: true

# Description: Adds a context to the signed-in user's career library.
module Mutations
  module CareerContexts
    class CreateCareerContext < Mutations::BaseMutation
      argument :attributes, Types::CareerContextAttributesInput, required: true

      field :career_context, Types::CareerContextType

      # Calls CareerLibrary::SaveLibraryEntryService.
      def resolve(attributes:)
        payload_from(
          ::CareerLibrary::SaveLibraryEntryService.call(user: current_user, kind: :career_context, attributes: attributes.to_h),
          :career_context
        )
      end
    end
  end
end
