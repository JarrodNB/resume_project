# Description: Determines coaching freshness while ignoring capitalization and whitespace edits.
# Index:
#   - call: compares revisions and the persisted reviewed answer snapshot
module InterviewPrep
  class FeedbackOutdatedService < ApplicationService
    # Receives the question whose saved feedback is displayed.
    def initialize(question:)
      @question = question
    end

    # Exact revisions are authoritative; formatting-only edits can reuse completed feedback.
    def call
      return success(false) if @question.feedback.blank?
      return success(true) if @question.feedback_question_revision != @question.question_revision
      return success(false) if @question.feedback_answer_revision == @question.answer_revision

      task = @question.ai_tasks.where(task_type: "review_interview_answer", status: "completed")
        .where("input ->> 'question_revision' = ? AND input ->> 'answer_revision' = ?",
          @question.feedback_question_revision.to_s, @question.feedback_answer_revision.to_s)
        .order(created_at: :desc, id: :desc).first
      reviewed = task&.input&.fetch("answer_text", nil)
      matching_feedback = task&.result&.fetch("interview_feedback", nil) == @question.feedback
      unchanged = reviewed.is_a?(String) && reviewed.squish.downcase == @question.answer_text.squish.downcase
      success(!(matching_feedback && unchanged))
    end
  end
end
