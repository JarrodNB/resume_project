# Queues a single editing turn. Immutable linked tasks keep old results from replacing
# newer turns, while the owner lock makes duplicate submissions reuse the same child.
module CareerLibrary
  class StartEditService < ApplicationService
    def initialize(user:, kind: nil, record_id: nil, feedback: "", previous_task_id: nil, skip: false)
      @user, @kind, @record_id = user, kind, record_id
      @feedback, @previous_id, @skip = feedback.to_s.strip, previous_task_id, skip
    end

    def call
      return failure([ "Keep feedback within #{TextLimits::PROSE} characters." ]) if @feedback.length > TextLimits::PROSE

      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "improve_library_entry",
        resolve_existing: -> { resolve_existing }, prepare_task: ->(task) { prepare(task) })
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    end

    private

    def resolve_existing
      if @previous_id
        @previous = @user.ai_tasks.improve_library_entry.find(@previous_id)
        # A failed review batch can replay its owned saved answers without inventing
        # new feedback. Ordinary edits still need feedback or an explicit skip.
        replay_batch = @previous.failed? && @previous.input.dig("review_question", "answers").is_a?(Array) && @previous.input.dig("review_question", "answers").any?
        return failure([ "Answer the question, or choose Skip." ]) if @feedback.blank? && !@skip && !replay_batch
        child = @user.ai_tasks.improve_library_entry.where("input ->> 'previous_task_id' = ?", @previous.id).first
        return child.input["feedback"] == @feedback && child.input["skip"] == @skip ? success(child) : failure([ "A newer turn already exists. Reload to continue." ]) if child
        return failure([ "Wait for the current turn to finish." ]) if @previous.queued?
        return failure([ "This draft is already closed. Start a new edit." ]) if @previous.accepted? || EditSnapshot.discarded?(@previous)
        return failure([ "This entry changed. Start a new edit from its current text." ]) if EditSnapshot.stale?(user: @user, task: @previous)
      else
        @snapshot = EditSnapshot.capture(user: @user, kind: @kind, record_id: @record_id)
        existing = EditSnapshot.latest(user: @user, kind: @kind, record_id: @record_id)
        if existing && !existing.accepted? && !EditSnapshot.discarded?(existing) && !EditSnapshot.stale?(user: @user, task: existing)
          return success(existing) unless existing.failed?
        end
      end
      nil
    end

    def prepare(task)
      if @previous
        return failure([ "This edit has reached its turn limit. Start a new edit." ]) if @previous.input["turn"].to_i >= EditSnapshot::MAX_TURNS
        task.input = @previous.input.except("feedback", "skip", "question_id", "history", "previous_task_id").merge(
          "previous_task_id" => @previous.id, "turn" => @previous.input["turn"].to_i + 1,
          "history" => @previous.message_history.presence || @previous.input["history"] || [],
          "question_id" => if @previous.needs_user_input?
            @previous.pending_questions.first&.fetch("id", nil)
          elsif @previous.failed?
            @previous.input["question_id"]
          end)
      else
        task.id = SecureRandom.uuid
        task.input = @snapshot.merge("root_id" => task.id, "turn" => 1, "history" => [])
      end
      task.input = task.input.merge("feedback" => @feedback, "skip" => @skip)
      if task.input.to_json.bytesize > EditSnapshot::MAX_INPUT_BYTES
        return failure([ "This edit is too long to continue. Start a new edit with less context." ])
      end
      success(task)
    end
  end
end
