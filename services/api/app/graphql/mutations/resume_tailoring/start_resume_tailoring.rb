# frozen_string_literal: true

# Description: Starts writing a resume for one of the signed-in user's jobs, or returns the
# tailoring task already in progress. Follow it with aiTaskUpdated.
module Mutations
  module ResumeTailoring
    class StartResumeTailoring < Mutations::BaseMutation
      argument :job_id, ID, required: true

      field :ai_task, Types::AiTaskType

      # Calls ResumeTailoring::StartResumeTailoringService.
      def resolve(job_id:)
        job = current_user.jobs.find(job_id)
        payload_from(::ResumeTailoring::StartResumeTailoringService.call(user: current_user, job: job), :ai_task)
      end
    end
  end
end
