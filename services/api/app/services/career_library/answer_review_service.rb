# Starts one proposal from an owned saved question set and any nonblank answers.
# The owner lock fences provenance, duplicate submissions, and unrelated draft conflicts.
module CareerLibrary
  class AnswerReviewService < ApplicationService
    def initialize(user:, review_task_id:, kind:, record_id:, answer: nil, answers: nil)
      @user, @review_id, @kind, @record_id = user, review_task_id, kind, record_id.to_s
      @legacy_answer, @batch = answer, answers
    end

    def call
      validation = normalize_answers
      return validation if validation

      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "improve_library_entry",
        resolve_existing: -> { resolve_existing }, prepare_task: ->(task) { prepare(task) })
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    end

    private

    # Canonical answer order makes retries insensitive to omitted blanks or browser ordering.
    # Question text is always copied later from the owned saved review, never from the client.
    def normalize_answers
      @submitted = []
      return failure([ "Submit either one legacy answer or an answer batch, not both." ]) if !@legacy_answer.nil? && !@batch.nil?
      values = @batch.nil? ? [ { question_index: 0, answer: @legacy_answer.to_s } ] : @batch
      return failure([ "Submit at most three review answers." ]) unless values.is_a?(Array) && values.length <= 3
      seen = []
      values.each do |raw|
        return failure([ "Choose answers from the saved review questions." ]) unless raw.respond_to?(:to_h)
        item = raw.to_h.symbolize_keys
        index, text = item.values_at(:question_index, :answer)
        unless index.is_a?(Integer) && index.between?(0, 2) && !seen.include?(index) && text.is_a?(String)
          return failure([ "Choose each saved question at most once." ])
        end
        seen << index
        return failure([ "Keep each answer within #{TextLimits::PROSE} characters." ]) if text.length > TextLimits::PROSE
        @submitted << { "question_index" => index, "answer" => text.strip } if text.strip.present?
      end
      return failure([ "Answer at least one review question before generating a revision." ]) if @submitted.empty?
      @indices = seen
      @submitted.sort_by! { |item| item["question_index"] }
      nil
    end

    def saved_answers(root)
      context = root.input.fetch("review_question")
      if context["answers"].is_a?(Array)
        context["answers"].map { |item| item.slice("question_index", "answer") }
      else
        [ { "question_index" => 0, "answer" => root.input["feedback"] } ]
      end
    end

    def resolve_existing
      review = @user.ai_tasks.review_library_section.find(@review_id)
      return failure([ "Wait for a completed review before answering." ]) unless review.completed?
      source = Array(review.result&.dig("assessments")).find { |item| item["kind"] == @kind && item["record_id"] == @record_id }
      return failure([ "Record not found" ]) unless source
      questions = ApplyReviewService.questions_for(source)
      return failure([ "This question is no longer current. Review this section again." ]) unless questions&.any?
      unless @indices.all? { |index| index < questions.length }
        return failure([ "Choose answers from the saved review questions." ])
      end
      @pairs = @submitted.map { |item| item.merge("question" => questions.fetch(item["question_index"])) }
      edits = @user.ai_tasks.improve_library_entry
        .where("input -> 'target' ->> 'kind' = ? AND input -> 'target' ->> 'record_id' = ?", @kind, @record_id)
      root = edits.where("input -> 'review_question' ->> 'review_task_id' = ? AND input ->> 'turn' = '1'", review.id).order(created_at: :desc, id: :desc).first
      if root
        return failure([ "This question already has an answer. Open its draft to revise it." ]) unless saved_answers(root) == @submitted
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
      @question = questions.first
      latest = edits.order(created_at: :desc, id: :desc).first
      if latest && !latest.accepted? && !latest.failed? && !EditSnapshot.stale?(user: @user, task: latest)
        return failure([ "An existing draft is open for this detail. Finish or discard it before answering the review question." ])
      end
      nil
    end

    def prepare(task)
      task.id = SecureRandom.uuid
      task.input = @snapshot.merge("root_id" => task.id, "turn" => 1, "history" => [], "feedback" => @batch.nil? ? @submitted.first.fetch("answer") : "", "skip" => false,
        "review_question" => @batch.nil? ? { "review_task_id" => @review_id, "question" => @question } :
          { "review_task_id" => @review_id, "answers" => @pairs })
      return failure([ "This edit is too long. Shorten the source or your answer." ]) if task.input.to_json.bytesize > EditSnapshot::MAX_INPUT_BYTES
      success(task)
    end
  end
end
