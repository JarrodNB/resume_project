# Accepts only the current claimed question explanation; usage is accounted independently.
# The caller holds owner, session, clarification and task locks in that order.
module Interviews
  class ApplyClarificationService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      interview = @task.user.interview_sessions.find_by(id: @task.subject_id)
      clarification = interview&.clarifications&.find_by(ai_task_id: @task.id)
      return failure("Question is no longer available") unless clarification && clarification.claimed_at &&
        clarification.deadline > Time.current && ClarificationPrompt.current?(interview, clarification.message) &&
        @task.input["question_text"] == clarification.message.content
      explanation = @result["explanation"] if @result.is_a?(Hash)
      return failure("Invalid question clarification") unless explanation.is_a?(String) && explanation.present? && explanation.length <= 1000
      clarification.update!(explanation: explanation)
      success(clarification)
    end
  end
end
