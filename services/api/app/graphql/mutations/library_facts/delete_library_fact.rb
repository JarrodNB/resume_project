# frozen_string_literal: true

# Description: Removes a fact from the signed-in user's career library. Job answers that pointed
# at it stay, unlinked.
module Mutations
  module LibraryFacts
    class DeleteLibraryFact < Mutations::BaseMutation
      argument :id, ID, required: true

      field :library_fact, Types::LibraryFactType

      # Calls Records::DestroyRecordService.
      def resolve(id:)
        fact = current_user.library_facts.find(id)
        payload_from(::Records::DestroyRecordService.call(record: fact), :library_fact)
      end
    end
  end
end
