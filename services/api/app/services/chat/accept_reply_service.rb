# Accept one exact screened submission and reply atomically; conflicting or stale results cannot rewrite history.
require "digest"
module Chat
  class AcceptReplyService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, attempt_id:, claim_generation:, reply:, screened_message_sha256:, summary_update: nil, library_screening: [])
      @library_screening = library_screening
      @summary_update = summary_update
      @operation, @attempt_id, @generation, @reply, @screened = operation, attempt_id, claim_generation, reply, screened_message_sha256
    end

    def call
      return failure("Invalid reply") unless @reply.is_a?(String) && @reply.strip.present? && @reply.length <= 8000
      return failure("Screened message differs") unless @screened == Digest::SHA256.hexdigest(@operation.message)
      return failure("Invalid library screening") unless @library_screening.is_a?(Array) && @library_screening.length <= 500 &&
        @library_screening.all? { |report| report.is_a?(Hash) && report["fields"].is_a?(Array) && report["fields"].length <= 16 && report["fingerprints"].is_a?(Hash) && report["fingerprints"].length <= 16 }
      summary_identity = @summary_update.is_a?(Hash) ? @summary_update.sort_by { |key, _| key.to_s }.to_h : @summary_update
      fingerprint = Digest::SHA256.hexdigest(JSON.generate([@attempt_id, @generation, @reply, @screened, summary_identity, *@library_screening.presence]))
      with_operation_lock do |conversation|
        next(@operation.result_fingerprint == fingerprint ? success(@operation.accepted_result) : failure("Accepted result conflicts")) if @operation.accepted?
        next failure("Claim is stale or expired") unless current_claim?
        next failure("Chat revision changed") unless (conversation.messages.maximum(:position) || 0) == @operation.expected_position
        next failure("Summary version changed") unless conversation.summary_version == @operation.summary_base_version
        next failure("Summary update conflicts with the claimed context") unless valid_summary_update?(conversation)
        position = @operation.expected_position
        user_message = conversation.messages.create!(role: "user", content: @operation.message, position: position + 1, screened_sha256: @screened)
        assistant = conversation.messages.create!(role: "assistant", content: @reply, position: position + 2)
        if @summary_update
          conversation.update!(summary_text: @summary_update.fetch("text"), summary_version: conversation.summary_version + 1,
            summary_through_position: @summary_update.fetch("through_position"))
        end
        CareerLibrary::RecordScreeningService.call(user: conversation.user, reports: @library_screening)
        receipt = { "message_ids" => [user_message.id, assistant.id] }
        @operation.update!(status: "accepted", result_fingerprint: fingerprint, accepted_result: receipt)
        conversation.update!(title: conversation.title == "New chat" ? @operation.message.squish.truncate(80) : conversation.title, updated_at: Time.current)
        AiTasks::UpdateTaskService.call(task: @operation.ai_task, attributes: { status: "completed", completed_at: Time.current })
        PublishUpdateService.call(conversation: conversation)
        success(receipt)
      end
    end

    private

    def valid_summary_update?(conversation)
      plan = @operation.summary_plan
      return @summary_update.nil? if plan.empty?
      return false unless @summary_update.is_a?(Hash) && @summary_update.keys.sort == %w[expected_version text through_position]

      text, version, through = @summary_update.values_at("text", "expected_version", "through_position")
      text.is_a?(String) && text.strip.present? && text.length <= 8000 && version.is_a?(Integer) &&
        version == conversation.summary_version && through.is_a?(Integer) &&
        through == plan.fetch("through_position") && through > conversation.summary_through_position &&
        through <= @operation.expected_position && through.even?
    end
  end
end
