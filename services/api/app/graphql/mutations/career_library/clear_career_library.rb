# frozen_string_literal: true

# Description: Empties the signed-in user's career library so a later resume import starts fresh.
module Mutations
  module CareerLibrary
    class ClearCareerLibrary < Mutations::BaseMutation
      field :user, Types::UserType

      # Calls CareerLibrary::ClearCareerLibraryService.
      def resolve
        payload_from(::CareerLibrary::ClearCareerLibraryService.call(user: current_user), :user)
      end
    end
  end
end
