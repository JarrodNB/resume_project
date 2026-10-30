# Queue a bounded preference turn with immutable, owner-resolved history and revision.
module JobPreferences
  class StartConversationService < ApplicationService
    MAX_TURNS = 12
    MAX_BYTES = 120_000

    def initialize(user:, message:, expected_version:, previous_task_id: nil)
      @user, @message, @version, @previous_id = user, message.to_s.strip, expected_version, previous_task_id
    end

    def call
      return failure([ "Describe what you want in 1–4000 characters." ]) if @message.blank? || @message.length > 4000
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "elicit_job_preferences",
        resolve_existing: method(:resolve_existing), prepare_task: method(:prepare))
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    end

    private

    def resolve_existing
      @profile = @user.reload.job_preference_profile
      current_version = @profile&.version || 0
      if @previous_id
        @previous = @user.ai_tasks.elicit_job_preferences.find(@previous_id)
        child = @user.ai_tasks.elicit_job_preferences.where("input ->> 'previous_task_id' = ?", @previous.id).first
        return child.input["message"] == @message ? success(child) : failure([ "A newer turn exists. Reload the conversation." ]) if child
        return failure([ "Wait for the current reply." ]) if @previous.queued?
        return failure([ "This conversation reached its turn limit. Start a new conversation." ]) if @previous.input["turn"].to_i >= MAX_TURNS
        expected = @previous.result&.fetch("profile_version", nil) || @previous.input["profile_version"]
        return failure([ UpdateProfileService::STALE_MESSAGE ]) unless expected == current_version
        latest = @user.ai_tasks.elicit_job_preferences.order(created_at: :desc, id: :desc).first
        return failure([ "A newer conversation exists. Reload to continue." ]) unless latest&.id == @previous.id
      else
        existing = @user.ai_tasks.elicit_job_preferences.queued.where("input ->> 'profile_version' = ?", current_version.to_s).order(created_at: :desc).first
        return existing.input["message"] == @message && existing.input["profile_version"] == @version ? success(existing) : failure([ "Wait for the current reply." ]) if existing
      end
      return failure([ UpdateProfileService::STALE_MESSAGE ]) unless @version == current_version
      nil
    end

    def prepare(task)
      generated = @user.ai_tasks.elicit_job_preferences.completed.order(created_at: :desc).limit(12).flat_map do |item|
        Array(item.result&.fetch("criteria", []))
      end
      trusted = Array(@profile&.draft_criteria).select do |item|
        generated.any? { |value| value.is_a?(Hash) && value.values_at("text", "priority") == item.values_at("text", "priority") }
      end.pluck("text")
      criteria = Array(@profile&.draft_criteria).map do |item|
        item.merge("screened" => Array(@profile&.screened_criteria_sha256).include?(Screening::RecordApprovalsService.field_fingerprint(item["text"])))
      end
      task.input = { "trusted_criteria" => trusted, "profile_version" => @version, "profile_id" => @profile&.id, "criteria" => criteria,
        "message" => @message, "turn" => (@previous&.input&.fetch("turn", 0) || 0) + 1,
        "previous_task_id" => @previous&.id, "history" => @previous&.message_history.presence || @previous&.input&.fetch("history", []) || [],
        "question_id" => if @previous&.needs_user_input?
          @previous.pending_questions.first&.fetch("id", nil)
                         elsif @previous&.failed?
          @previous.input["question_id"]
                         end }
      return failure([ "This conversation is too long. Start a new conversation." ]) if task.input.to_json.bytesize > MAX_BYTES
      success(task)
    end
  end
end
