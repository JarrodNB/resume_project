# Checks the small editing result contract before a task is exposed or resumed.
# Generated text is validated, never sent through the user-input classifier.
module CareerLibrary
  class ApplyEditService < ApplicationService
    def initialize(ai_task:, message:)
      @task, @message = ai_task, message
    end

    def self.valid_proposal?(result, target)
      return false unless result.is_a?(Hash)
      limit = target["kind"] == "experience_highlight" ? TextLimits::BULLET : TextLimits::PROSE
      result["text"].is_a?(String) && result["text"].strip.present? && result["text"].length <= limit &&
        %w[red yellow green].include?(result["color"]) && result["reason"].is_a?(String) &&
        result["reason"].strip.present? && result["reason"].length <= 240
    end

    # Each callback carries only this turn's new generated state. Canonical source,
    # feedback and deferred answers stay in owned records/commands and are rebuilt.
    def self.generated_history?(history)
      history.is_a?(Array) && history.all? do |message|
        next false unless message.is_a?(Hash) && message["parts"].is_a?(Array)
        if message["kind"] == "response"
          message["parts"].all? { |part| part.is_a?(Hash) && part["part_kind"] != "user-prompt" }
        elsif message["kind"] == "request"
          !message.key?("instructions") && message["parts"].any? && message["parts"].all? do |part|
            part.is_a?(Hash) && (part["part_kind"] == "retry-prompt" ||
              part["part_kind"] == "tool-return" && part["tool_name"] != "ask_user")
          end
        else
          false
        end
      end
    end

    def call
      if @task.input["review_question"] && @message["status"] != "completed"
        return failure([ "The review answer did not produce a proposal. Please try again." ])
      end
      history = @message["message_history"]
      valid = self.class.generated_history?(history) && history.to_json.bytesize <= 100_000
      if @message["status"] == "completed"
        valid &&= self.class.valid_proposal?(@message["result"], @task.input.fetch("target"))
      else
        questions = @message["pending_questions"]
        question = questions.is_a?(Array) && questions.one? ? questions.first : nil
        valid &&= question.is_a?(Hash) && question["id"].is_a?(String) && question["id"].present? &&
          question["question"].is_a?(String) && question["question"].strip.present? && question["question"].length <= 500 && history.present?
      end
      valid ? success({ message_history: history }) : failure([ "The edit returned an invalid draft or question. Please try again." ])
    end
  end
end
