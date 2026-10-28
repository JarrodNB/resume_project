# frozen_string_literal: true

# Description: Saves the signed-in user's answer to one requirement of one job. A blank body
# clears it. addToLibrary also stores a career context entry.
module Mutations
  module GapResponses
    class SaveGapResponse < Mutations::BaseMutation
      argument :job_id, ID, required: true
      argument :requirement, String, required: true
      argument :body, String, required: true
      argument :add_to_library, Boolean, required: true

      field :job_gap_response, Types::JobGapResponseType, null: true

      # Calls GapResponses::SaveGapResponseService.
      def resolve(job_id:, requirement:, body:, add_to_library:)
        job = current_user.jobs.find(job_id)
        result = ::GapResponses::SaveGapResponseService.call(
          job: job, requirement: requirement, body: body, add_to_library: add_to_library
        )
        payload_from(result, :job_gap_response)
      end
    end
  end
end
