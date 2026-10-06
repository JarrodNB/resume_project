# frozen_string_literal: true

# Description: Updates the signed-in user's career-library profile.
module Mutations
  module Users
    class UpdateProfile < Mutations::BaseMutation
      argument :attributes, Types::ProfileAttributesInput, required: true

      field :user, Types::UserType

      # Calls Users::UpdateProfileService.
      def resolve(attributes:)
        payload_from(::Users::UpdateProfileService.call(user: current_user, attributes: attributes.to_h), :user)
      end
    end
  end
end
