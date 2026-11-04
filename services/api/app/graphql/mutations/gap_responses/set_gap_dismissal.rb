# frozen_string_literal: true

# Description: Dismisses or restores one requirement of the signed-in user's job.
module Mutations
  module GapResponses
    class SetGapDismissal < Mutations::BaseMutation
      argument :job_id, ID, required: true
      argument :requirement, String, required: true
      argument :dismissed, Boolean, required: true

      field :job, Types::JobType, null: true

      # Calls GapResponses::SetGapDismissalService.
      def resolve(job_id:, requirement:, dismissed:)
        job = current_user.jobs.find(job_id)
        result = ::GapResponses::SetGapDismissalService.call(job: job, requirement: requirement, dismissed: dismissed)
        payload_from(result, :job)
      end
    end
  end
end
