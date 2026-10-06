# frozen_string_literal: true

# Description: Updates a skill in the signed-in user's career library.
module Mutations
  module Skills
    class UpdateSkill < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::SkillAttributesInput, required: true

      field :skill, Types::SkillType

      # Calls Skills::UpdateSkillService.
      def resolve(id:, attributes:)
        skill = current_user.skills.find(id)
        payload_from(::Skills::UpdateSkillService.call(skill: skill, attributes: attributes.to_h), :skill)
      end
    end
  end
end
