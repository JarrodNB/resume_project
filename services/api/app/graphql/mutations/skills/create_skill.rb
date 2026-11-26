# frozen_string_literal: true

# Description: Adds a skill to the signed-in user's career library.
module Mutations
  module Skills
    class CreateSkill < Mutations::BaseMutation
      argument :attributes, Types::SkillAttributesInput, required: true

      field :skill, Types::SkillType

      # Calls CareerLibrary::SaveLibraryEntryService.
      def resolve(attributes:)
        payload_from(::CareerLibrary::SaveLibraryEntryService.call(user: current_user, kind: :skill, attributes: attributes.to_h), :skill)
      end
    end
  end
end
