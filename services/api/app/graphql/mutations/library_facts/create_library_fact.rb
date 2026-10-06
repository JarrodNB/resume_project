# frozen_string_literal: true

# Description: Adds a fact to the signed-in user's career library.
module Mutations
  module LibraryFacts
    class CreateLibraryFact < Mutations::BaseMutation
      argument :attributes, Types::LibraryFactAttributesInput, required: true

      field :library_fact, Types::LibraryFactType

      # Calls LibraryFacts::CreateLibraryFactService.
      def resolve(attributes:)
        payload_from(
          ::LibraryFacts::CreateLibraryFactService.call(user: current_user, attributes: attributes.to_h),
          :library_fact
        )
      end
    end
  end
end
