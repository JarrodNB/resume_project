# Closes one owned exchange; late worker output cannot revive a discarded task.
module Mutations
  module CareerLibrary
    class DiscardLibraryEdit < Mutations::BaseMutation
      argument :ai_task_id, ID, required: true
      field :ai_task, Types::AiTaskType

      def resolve(ai_task_id:)
        payload_from(::CareerLibrary::FinishEditService.call(user: current_user, ai_task_id: ai_task_id, discard: true), :ai_task)
      end
    end
  end
end
