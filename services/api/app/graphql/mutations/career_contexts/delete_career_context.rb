# frozen_string_literal: true

# Description: Removes a context from the signed-in user's career library. Job answers that pointed
# at it stay, unlinked.
module Mutations
  module CareerContexts
    class DeleteCareerContext < Mutations::BaseMutation
      argument :id, ID, required: true

      field :career_context, Types::CareerContextType

      # Calls Records::DestroyRecordService.
      def resolve(id:)
        context = current_user.career_contexts.find(id)
        payload_from(::Records::DestroyRecordService.call(record: context), :career_context)
      end
    end
  end
end
