# Starts or continues one owned library editing exchange without waiting for the model.
module Mutations
  module CareerLibrary
    class StartLibraryEdit < Mutations::BaseMutation
      argument :kind, String, required: false
      argument :record_id, ID, required: false
      argument :feedback, String, required: false, default_value: ""
      argument :previous_task_id, ID, required: false
      argument :skip, Boolean, required: false, default_value: false
      field :ai_task, Types::AiTaskType

      def resolve(**arguments)
        payload_from(::CareerLibrary::StartEditService.call(user: current_user, **arguments), :ai_task)
      end
    end
  end
end
