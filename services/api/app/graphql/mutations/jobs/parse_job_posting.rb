# frozen_string_literal: true

# Description: Starts turning a pasted job advertisement into a new Job. Follow progress with
# the aiTaskUpdated subscription; once completed, the task's `job` is the saved Job.
module Mutations
  module Jobs
    class ParseJobPosting < Mutations::BaseMutation
      argument :text, String, required: true, description: "The full job advertisement, pasted as text."

      field :ai_task, Types::AiTaskType

      # Calls Jobs::StartJobPostingParseService.
      def resolve(text:)
        payload_from(::Jobs::StartJobPostingParseService.call(user: current_user, text: text), :ai_task)
      end
    end
  end
end
