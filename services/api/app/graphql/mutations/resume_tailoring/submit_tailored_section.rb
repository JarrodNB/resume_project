# frozen_string_literal: true

# Description: Approves, edits, omits, or reopens one section of a tailoring task the user owns.
# Reopening discards every section after the one reopened. The worker screens an edit.
module Mutations
  module ResumeTailoring
    class SubmitTailoredSection < Mutations::BaseMutation
      argument :ai_task_id, ID, required: true
      argument :section_type, String, required: true
      argument :action, String, required: true
      argument :content, GraphQL::Types::JSON, required: false

      field :ai_task, Types::AiTaskType

      # Calls ResumeTailoring::SubmitTailoredSectionService.
      def resolve(ai_task_id:, section_type:, action:, content: {})
        ai_task = current_user.ai_tasks.find(ai_task_id)
        result = ::ResumeTailoring::SubmitTailoredSectionService.call(
          ai_task: ai_task, section_type: section_type, action: action, content: content
        )
        payload_from(result, :ai_task)
      end
    end
  end
end
