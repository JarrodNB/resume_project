# frozen_string_literal: true

# Saves a finished Markdown draft once, using the user's final edits when supplied.
module Mutations
  module ResumeTailoring
    class SaveTailoredResume < Mutations::BaseMutation
      argument :ai_task_id, ID, required: true
      argument :markdown, String, required: false

      field :resume, Types::ResumeType

      # Calls ResumeTailoring::SaveTailoredResumeService.
      def resolve(ai_task_id:, markdown: nil)
        ai_task = current_user.ai_tasks.find(ai_task_id)
        payload_from(
          ::ResumeTailoring::SaveTailoredResumeService.call(ai_task: ai_task, markdown: markdown),
          :resume
        )
      end
    end
  end
end
