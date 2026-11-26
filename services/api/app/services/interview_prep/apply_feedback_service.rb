# Description: Stores coaching against reviewed revisions without changing the saved answer.
# Index:
#   - call: checks task identity and output shape, then persists revision-bound feedback
module InterviewPrep
  class ApplyFeedbackService < ApplicationService
    # Receives a task locked after its owner and the worker's structured result.
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    # Allows newer answer edits but never marks their feedback as current.
    def call
      question = current_question
      return failure([ "This feedback is out of date. Request feedback again." ]) unless question

      feedback = validated_feedback
      return failure([ "We couldn't save valid feedback. Request feedback again." ]) unless feedback

      question.update!(feedback: feedback,
        feedback_question_revision: @task.input["question_revision"],
        feedback_answer_revision: @task.input["answer_revision"])
      success(question)
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # Returns the saved question only while the fence says the task is current.
    def current_question
      @task.subject unless PracticeTaskFence.stale_reason(@task)
    end

    # Validates the complete shape before touching existing coaching.
    def validated_feedback
      return unless @result.is_a?(Hash)

      feedback = @result["interview_feedback"]
      return unless feedback.is_a?(Hash)
      return unless %w[strengths improvements].all? do |key|
        feedback[key].is_a?(Array) && feedback[key].length.between?(1, 5) &&
          feedback[key].all? { |text| text.is_a?(String) && text.strip.present? }
      end
      return unless feedback["example_answer"].is_a?(String) &&
                    feedback["example_answer"].strip.length.between?(1, TextLimits::INTERVIEW_ANSWER)
      return unless feedback["evidence_quotes"].is_a?(Array) &&
                    feedback["evidence_quotes"].all? { |text| text.is_a?(String) && text.strip.present? }

      feedback.slice("strengths", "improvements", "example_answer", "evidence_quotes")
    end
  end
end
