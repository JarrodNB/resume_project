# frozen_string_literal: true

# Description: Adds a role (with bullet points) to the signed-in user's career library.
module Mutations
  module Experiences
    class CreateExperience < Mutations::BaseMutation
      argument :attributes, Types::ExperienceAttributesInput, required: true
      argument :highlights, [ String ], required: false, default_value: []

      field :experience, Types::ExperienceType

      # Calls Experiences::CreateExperienceService.
      def resolve(attributes:, highlights:)
        result = ::Experiences::CreateExperienceService.call(
          user: current_user, attributes: attributes.to_h, highlights: highlights
        )
        payload_from(result, :experience)
      end
    end
  end
end
