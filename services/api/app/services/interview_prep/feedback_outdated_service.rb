# Description: Determines coaching freshness while ignoring capitalization and whitespace edits.
# Index:
#   - call: compares revisions and the reviewed answer’s normalized digest
require "digest"

module InterviewPrep
  class FeedbackOutdatedService < ApplicationService
    # Preserve formatting-only freshness without keeping another copy of the answer.
    def self.answer_fingerprint(text)
      Digest::SHA256.hexdigest(text.squish.downcase)
    end

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
      fingerprint = task&.input&.fetch("normalized_answer_sha256", nil)
      # Retained task copies are used only to verify old feedback, never as AI input.
      fingerprint ||= self.class.answer_fingerprint(reviewed) if reviewed.is_a?(String)
      matching_feedback = task&.result&.fetch("interview_feedback", nil) == @question.feedback
      unchanged = fingerprint == self.class.answer_fingerprint(@question.answer_text)
      success(!(matching_feedback && unchanged))
    end
  end
end
