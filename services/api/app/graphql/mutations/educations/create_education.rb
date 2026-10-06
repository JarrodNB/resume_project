# frozen_string_literal: true

# Description: Adds an education entry to the signed-in user's career library.
module Mutations
  module Educations
    class CreateEducation < Mutations::BaseMutation
      argument :attributes, Types::EducationAttributesInput, required: true

      field :education, Types::EducationType

      # Calls Educations::CreateEducationService.
      def resolve(attributes:)
        payload_from(::Educations::CreateEducationService.call(user: current_user, attributes: attributes.to_h), :education)
      end
    end
  end
end
