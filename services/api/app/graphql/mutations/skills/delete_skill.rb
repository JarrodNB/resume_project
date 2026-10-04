# frozen_string_literal: true

# Description: Removes a skill from the signed-in user's career library.
module Mutations
  module Skills
    class DeleteSkill < Mutations::BaseMutation
      argument :id, ID, required: true

      field :skill, Types::SkillType

      # Calls Records::DestroyRecordService.
      def resolve(id:)
        skill = current_user.skills.find(id)
        payload_from(::Records::DestroyRecordService.call(record: skill), :skill)
      end
    end
  end
end
