# Closes a summary proposal without writing profile or resume text.
module Mutations
  module SummaryGeneration
    class DiscardSummaryGeneration < Mutations::BaseMutation
      argument :ai_task_id, ID, required: true
      field :ai_task, Types::AiTaskType

      def resolve(**arguments)
        payload_from(::SummaryGeneration::FinishGenerationService.call(user: current_user, discard: true, **arguments), :ai_task)
      end
    end
  end
end
