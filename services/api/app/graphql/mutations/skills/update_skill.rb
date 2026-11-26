# frozen_string_literal: true

# Description: Updates a skill in the signed-in user's career library.
module Mutations
  module Skills
    class UpdateSkill < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::SkillAttributesInput, required: true

      field :skill, Types::SkillType

      # Calls CareerLibrary::SaveLibraryEntryService.
      def resolve(id:, attributes:)
        skill = current_user.skills.find(id)
        payload_from(::CareerLibrary::SaveLibraryEntryService.call(user: current_user, kind: :skill, entry: skill, attributes: attributes.to_h), :skill)
      end
    end
  end
end
