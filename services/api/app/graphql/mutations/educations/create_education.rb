# frozen_string_literal: true

# Description: Adds an education entry to the signed-in user's career library.
module Mutations
  module Educations
    class CreateEducation < Mutations::BaseMutation
      argument :attributes, Types::EducationAttributesInput, required: true

      field :education, Types::EducationType

      # Calls CareerLibrary::SaveLibraryEntryService.
      def resolve(attributes:)
        payload_from(::CareerLibrary::SaveLibraryEntryService.call(user: current_user, kind: :education, attributes: attributes.to_h), :education)
      end
    end
  end
end
