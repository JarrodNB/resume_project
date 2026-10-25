# Starts an individual proposal from an owned review question and a new user answer.
# The owner lock fences provenance, duplicate submissions, and unrelated draft conflicts.
module CareerLibrary
  class AnswerReviewService < ApplicationService
    def initialize(user:, review_task_id:, kind:, record_id:, answer:)
      @user, @review_id, @kind, @record_id = user, review_task_id, kind, record_id.to_s
      @answer = answer.to_s.strip
    end

    def call
      return failure([ "Answer the review question before generating a revision." ]) if @answer.blank?
      return failure([ "Keep your answer within #{TextLimits::PROSE} characters." ]) if @answer.length > TextLimits::PROSE

      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "improve_library_entry",
        resolve_existing: -> { resolve_existing }, prepare_task: ->(task) { prepare(task) })
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    end

    private

    def resolve_existing
      review = @user.ai_tasks.review_library_section.find(@review_id)
      return failure([ "Wait for a completed review before answering." ]) unless review.completed?
      edits = @user.ai_tasks.improve_library_entry
        .where("input -> 'target' ->> 'kind' = ? AND input -> 'target' ->> 'record_id' = ?", @kind, @record_id)
      root = edits.where("input -> 'review_question' ->> 'review_task_id' = ? AND input ->> 'turn' = '1'", review.id).order(created_at: :desc, id: :desc).first
      if root
        return failure([ "This question already has an answer. Open its draft to revise it." ]) unless root.input["feedback"] == @answer
        latest = edits.order(created_at: :desc, id: :desc).first
        return failure([ "A newer edit exists. Open it before answering this review again." ]) unless latest.input["root_id"] == root.id
        return failure([ "This answer was discarded. Review this section again for a new question." ]) if EditSnapshot.discarded?(latest)
        return success(latest)
      end

      @snapshot = EditSnapshot.capture(user: @user, kind: @kind, record_id: @record_id)
      state = ReviewStateService.call(user: @user, section: @snapshot["section"]).value
      assessment = state[:assessments].find { |item| item["kind"] == @kind && item["record_id"] == @record_id }
      unless assessment && assessment["review_task_id"] == review.id && !assessment["stale"] && assessment["question"].is_a?(String) && assessment["question"].strip.present?
        return failure([ "This question is no longer current. Review this section again." ])
      end
      @question = assessment["question"]
      latest = edits.order(created_at: :desc, id: :desc).first
      if latest && !latest.accepted? && !latest.failed? && !EditSnapshot.stale?(user: @user, task: latest)
        return failure([ "An existing draft is open for this detail. Finish or discard it before answering the review question." ])
      end
      nil
    end

    def prepare(task)
      task.id = SecureRandom.uuid
      task.input = @snapshot.merge("root_id" => task.id, "turn" => 1, "history" => [], "feedback" => @answer, "skip" => false,
        "review_question" => { "review_task_id" => @review_id, "question" => @question })
      return failure([ "This edit is too long. Shorten the source or your answer." ]) if task.input.to_json.bytesize > EditSnapshot::MAX_INPUT_BYTES
      success(task)
    end
  end
end
