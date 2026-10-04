# frozen_string_literal: true

# Description: Starts comparing one of the signed-in user's jobs with their career library.
# Follow progress with the aiTaskUpdated subscription; the completed task's `result` holds
# `gap_analysis`, and the job's `latestGapAnalysis` returns the task.
module Mutations
  module GapAnalysis
    class AnalyzeJobGaps < Mutations::BaseMutation
      argument :job_id, ID, required: true

      field :ai_task, Types::AiTaskType

      # Calls GapAnalysis::StartGapAnalysisService.
      def resolve(job_id:)
        job = current_user.jobs.find(job_id)
        payload_from(::GapAnalysis::StartGapAnalysisService.call(user: current_user, job: job), :ai_task)
      end
    end
  end
end
