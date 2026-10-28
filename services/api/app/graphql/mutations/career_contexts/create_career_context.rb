# frozen_string_literal: true

# Description: Adds a context to the signed-in user's career library.
module Mutations
  module CareerContexts
    class CreateCareerContext < Mutations::BaseMutation
      argument :attributes, Types::CareerContextAttributesInput, required: true

      field :career_context, Types::CareerContextType

      # Calls CareerContexts::CreateCareerContextService.
      def resolve(attributes:)
        payload_from(
          ::CareerContexts::CreateCareerContextService.call(user: current_user, attributes: attributes.to_h),
          :career_context
        )
      end
    end
  end
end
