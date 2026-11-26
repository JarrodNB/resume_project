# frozen_string_literal: true

# Description: Updates a career library role. Passing `highlights` replaces all bullet points.
module Mutations
  module Experiences
    class UpdateExperience < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::ExperienceAttributesInput, required: true
      argument :highlights, [ String ], required: false

      field :experience, Types::ExperienceType

      # Calls CareerLibrary::SaveLibraryEntryService.
      def resolve(id:, attributes:, highlights: nil)
        experience = current_user.experiences.find(id)
        result = ::CareerLibrary::SaveLibraryEntryService.call(user: current_user, kind: :experience, entry: experience, attributes: attributes.to_h, highlights: highlights)
        payload_from(result, :experience)
      end
    end
  end
end
