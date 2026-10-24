# Accepts the exact proposal saved on an owned editing task.
module Mutations
  module CareerLibrary
    class AcceptLibraryEdit < Mutations::BaseMutation
      argument :ai_task_id, ID, required: true
      field :ai_task, Types::AiTaskType

      def resolve(ai_task_id:)
        payload_from(::CareerLibrary::FinishEditService.call(user: current_user, ai_task_id: ai_task_id), :ai_task)
      end
    end
  end
end
