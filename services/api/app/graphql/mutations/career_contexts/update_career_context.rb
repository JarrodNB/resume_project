# frozen_string_literal: true

# Description: Updates a context in the signed-in user's career library.
module Mutations
  module CareerContexts
    class UpdateCareerContext < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::CareerContextAttributesInput, required: true

      field :career_context, Types::CareerContextType

      # Calls CareerContexts::UpdateCareerContextService.
      def resolve(id:, attributes:)
        context = current_user.career_contexts.find(id)
        payload_from(
          ::CareerContexts::UpdateCareerContextService.call(career_context: context, attributes: attributes.to_h),
          :career_context
        )
      end
    end
  end
end
