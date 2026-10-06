# frozen_string_literal: true

# Description: Adds a skill to the signed-in user's career library.
module Mutations
  module Skills
    class CreateSkill < Mutations::BaseMutation
      argument :attributes, Types::SkillAttributesInput, required: true

      field :skill, Types::SkillType

      # Calls Skills::CreateSkillService.
      def resolve(attributes:)
        payload_from(::Skills::CreateSkillService.call(user: current_user, attributes: attributes.to_h), :skill)
      end
    end
  end
end
