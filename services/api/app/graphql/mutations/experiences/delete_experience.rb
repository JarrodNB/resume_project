# frozen_string_literal: true

# Description: Removes a role (and its bullet points) from the signed-in user's career library.
module Mutations
  module Experiences
    class DeleteExperience < Mutations::BaseMutation
      argument :id, ID, required: true

      field :experience, Types::ExperienceType

      # Calls Records::DestroyRecordService.
      def resolve(id:)
        experience = current_user.experiences.find(id)
        payload_from(::Records::DestroyRecordService.call(record: experience), :experience)
      end
    end
  end
end
