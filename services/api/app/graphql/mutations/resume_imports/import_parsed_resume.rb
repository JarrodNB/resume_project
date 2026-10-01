# frozen_string_literal: true

# Description: Imports a reviewed parsed resume into the career library and creates a base resume.
module Mutations
  module ResumeImports
    class ImportParsedResume < Mutations::BaseMutation
      argument :ai_task_id, ID, required: true, description: "The completed parse_resume task."
      argument :parsed_resume, GraphQL::Types::JSON, required: true,
               description: "The task's parsed_resume result, as edited by the user."

      field :resume, Types::ResumeType

      # Finds the user's task and calls ResumeImports::ImportParsedResumeService.
      def resolve(ai_task_id:, parsed_resume:)
        ai_task = current_user.ai_tasks.find(ai_task_id)
        result = ::ResumeImports::ImportParsedResumeService.call(ai_task: ai_task, parsed_resume: parsed_resume)
        payload_from(result, :resume)
      end
    end
  end
end
