# frozen_string_literal: true

# Description: Updates an education entry in the signed-in user's career library.
module Mutations
  module Educations
    class UpdateEducation < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::EducationAttributesInput, required: true

      field :education, Types::EducationType

      # Calls Educations::UpdateEducationService.
      def resolve(id:, attributes:)
        education = current_user.educations.find(id)
        payload_from(::Educations::UpdateEducationService.call(education: education, attributes: attributes.to_h), :education)
      end
    end
  end
end
