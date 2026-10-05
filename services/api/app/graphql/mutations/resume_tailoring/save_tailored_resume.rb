# frozen_string_literal: true

# Description: Saves a finished tailoring draft as a Resume, once. sections is the final
# editor's copy; when omitted, the draft on the task is saved.
module Mutations
  module ResumeTailoring
    class SaveTailoredResume < Mutations::BaseMutation
      argument :ai_task_id, ID, required: true
      argument :sections, GraphQL::Types::JSON, required: false

      field :resume, Types::ResumeType

      # Calls ResumeTailoring::SaveTailoredResumeService.
      def resolve(ai_task_id:, sections: nil)
        ai_task = current_user.ai_tasks.find(ai_task_id)
        payload_from(
          ::ResumeTailoring::SaveTailoredResumeService.call(ai_task: ai_task, sections: sections),
          :resume
        )
      end
    end
  end
end
