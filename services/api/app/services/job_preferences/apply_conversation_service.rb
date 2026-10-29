# Validate an accepted dialogue turn, then update only the unchanged editable draft.
module JobPreferences
  class ApplyConversationService < ApplicationService
    def initialize(ai_task:, message:)
      @task, @message = ai_task, message
    end

    def call
      profile = @task.user.reload.job_preference_profile || @task.user.build_job_preference_profile
      latest = @task.user.ai_tasks.elicit_job_preferences.order(created_at: :desc, id: :desc).first
      return failure([UpdateProfileService::STALE_MESSAGE]) unless profile.version == @task.input["profile_version"] && latest&.id == @task.id
      history = @message["message_history"]
      return failure(["The conversation returned invalid history. Please try again."]) unless valid_history?(history)
      if @message["status"] == "needs_user_input"
        question = @message["pending_questions"]
        valid = question.is_a?(Array) && question.one? && question.first.is_a?(Hash) &&
          question.first["id"].is_a?(String) && question.first["id"].present? &&
          question.first["question"].is_a?(String) && question.first["question"].strip.present? && question.first["question"].length <= 500 && deferred_question_matches?(history, question.first)
        return valid ? success({message_history: history}) : failure(["The conversation returned an invalid question."])
      end
      output = @message["result"]
      return failure(["The conversation returned an invalid summary."]) unless output.is_a?(Hash) &&
        output["reply"].is_a?(String) && output["reply"].strip.present? && output["reply"].length <= 1000 && output["criteria"].is_a?(Array)
      existing = profile.draft_criteria
      criteria = output["criteria"].map do |value|
        return failure(["The conversation returned an invalid preference."]) unless value.is_a?(Hash)
        # Keep IDs for unchanged meaning; never trust model-authored record identities.
        match = existing.find { |item| item.values_at("text", "priority") == value.values_at("text", "priority") }
        value.slice("text", "priority").merge("id" => match&.fetch("id", nil))
      end
      updated = UpdateProfileService.call(user: @task.user, expected_version: profile.version, action: :save_draft, criteria: criteria)
      return updated unless updated.success?
      accepted = output.slice("reply").merge("criteria" => updated.value.draft_criteria, "profile_version" => updated.value.version)
      success({message_history: history, result: accepted})
    end

    private

    def valid_history?(history)
      return false unless history.is_a?(Array) && history.present? && history.to_json.bytesize <= 100_000
      history.all? do |message|
        next false unless message.is_a?(Hash) && %w[request response].include?(message["kind"]) && message["parts"].is_a?(Array) && message["parts"].present?
        allowed = message["kind"] == "request" ? %w[system-prompt user-prompt tool-return retry-prompt] : %w[text tool-call thinking]
        message["parts"].all? do |part|
          next false unless part.is_a?(Hash) && allowed.include?(part["part_kind"])
          case part["part_kind"]
          when "tool-call"
            part["tool_name"].is_a?(String) && part["tool_call_id"].is_a?(String) && (part["args"].is_a?(Hash) || part["args"].is_a?(String))
          when "tool-return"
            part["tool_name"].is_a?(String) && part["tool_call_id"].is_a?(String) && part.key?("content")
          else
            part["content"].is_a?(String) || (part["part_kind"] == "retry-prompt" && part["content"].is_a?(Array))
          end
        end
      end
    end

    def deferred_question_matches?(history, question)
      last = history.reverse.find { |item| item["kind"] == "response" }
      calls = Array(last&.fetch("parts", nil)).select { |part| part["part_kind"] == "tool-call" }
      return false unless calls.one?
      call = calls.first
      args = call["args"].is_a?(String) ? JSON.parse(call["args"]) : call["args"]
      call["tool_name"] == "ask_user" && call["tool_call_id"] == question["id"] && args.is_a?(Hash) && args["question"] == question["question"]
    rescue JSON::ParserError
      false
    end
  end
end
