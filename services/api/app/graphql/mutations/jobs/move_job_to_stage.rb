# frozen_string_literal: true

# Description: Moves one of the signed-in user's jobs to a new application stage.
module Mutations
  module Jobs
    class MoveJobToStage < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :stage, Types::JobStageEnum, required: true

      field :job, Types::JobType

      # Calls Jobs::MoveJobToStageService.
      def resolve(id:, stage:)
        job = current_user.jobs.find(id)
        payload_from(::Jobs::MoveJobToStageService.call(job: job, stage: stage), :job)
      end
    end
  end
end
