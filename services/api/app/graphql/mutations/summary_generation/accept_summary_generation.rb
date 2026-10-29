# Saves an explicitly reviewed proposal, optionally edited by its owner.
module Mutations
  module SummaryGeneration
    class AcceptSummaryGeneration < Mutations::BaseMutation
      argument :ai_task_id, ID, required: true
      argument :text, String, required: false
      field :ai_task, Types::AiTaskType

      def resolve(**arguments)
        payload_from(::SummaryGeneration::FinishGenerationService.call(user: current_user, **arguments), :ai_task)
      end
    end
  end
end
