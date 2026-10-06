# frozen_string_literal: true

# Description: Updates a fact in the signed-in user's career library.
module Mutations
  module LibraryFacts
    class UpdateLibraryFact < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::LibraryFactAttributesInput, required: true

      field :library_fact, Types::LibraryFactType

      # Calls LibraryFacts::UpdateLibraryFactService.
      def resolve(id:, attributes:)
        fact = current_user.library_facts.find(id)
        payload_from(
          ::LibraryFacts::UpdateLibraryFactService.call(library_fact: fact, attributes: attributes.to_h),
          :library_fact
        )
      end
    end
  end
end
