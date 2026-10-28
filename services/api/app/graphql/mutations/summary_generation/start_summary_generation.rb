# Starts an owned missing-summary proposal without waiting for model execution.
module Mutations
  module SummaryGeneration
    class StartSummaryGeneration < Mutations::BaseMutation
      argument :target_kind, String, required: true
      argument :target_id, ID, required: false
      field :ai_task, Types::AiTaskType

      def resolve(**arguments)
        payload_from(::SummaryGeneration::StartGenerationService.call(user: current_user, **arguments), :ai_task)
      end
    end
  end
end
