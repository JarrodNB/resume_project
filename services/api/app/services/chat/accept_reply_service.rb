# Accept one exact screened submission and reply atomically; conflicting or stale results cannot rewrite history.
#
# The worker may also report career-library or active saved-job fields its tools screened.
# Those `record_screening` receipts are saved through Screening::RecordApprovalsService
# with the reply after its exact claim fences. Optional generated career context is
# created in that same transaction; conflicts reject the entire acceptance. Only this explicit chat context allows
# taskless owned active-job approvals; unrelated taskless callers retain library-only scope.
require "digest"
module Chat
  class AcceptReplyService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, attempt_id:, claim_generation:, reply:, screened_message_sha256:, summary_update: nil, record_screening: [], career_context: nil)
      @career_context = career_context
      @record_screening = record_screening
      @summary_update = summary_update
      @operation, @attempt_id, @generation, @reply, @screened = operation, attempt_id, claim_generation, reply, screened_message_sha256
    end

    def call
      return failure("Invalid reply") unless @reply.is_a?(String) && @reply.strip.present? && @reply.length <= 8000
      return failure("Screened message differs") unless @screened == Digest::SHA256.hexdigest(@operation.message)
      return failure("Invalid record screening") unless @record_screening.is_a?(Array) && @record_screening.length <= 500 &&
        @record_screening.all? { |report| report.is_a?(Hash) && report["fingerprints"].is_a?(Hash) && report["fingerprints"].length <= 16 && (report["revision"].nil? || report["revision"].is_a?(Hash)) }
      return failure("Invalid career context") unless valid_career_context?
      summary_identity = @summary_update.is_a?(Hash) ? @summary_update.sort_by { |key, _| key.to_s }.to_h : @summary_update
      record_identity = @record_screening.present? ? [{ "record_screening" => @record_screening }] : []
      record_identity << { "career_context" => @career_context.sort.to_h } if @career_context
      fingerprint = Digest::SHA256.hexdigest(JSON.generate([@attempt_id, @generation, @reply, @screened, summary_identity, *record_identity]))
      with_operation_lock do |conversation|
        next(@operation.result_fingerprint == fingerprint ? success(@operation.accepted_result) : failure("Accepted result conflicts")) if @operation.accepted?
        next failure("Claim is stale or expired") unless current_claim?
        next failure("Chat revision changed") unless (conversation.messages.maximum(:position) || 0) == @operation.expected_position
        next failure("Summary version changed") unless conversation.summary_version == @operation.summary_base_version
        next failure("Summary update conflicts with the claimed context") unless valid_summary_update?(conversation)
        if @career_context
          result = save_career_context(conversation.user)
          next result unless result.success?
        end
        position = @operation.expected_position
        user_message = conversation.messages.create!(role: "user", content: @operation.message, position: position + 1, screened_sha256: @screened)
        assistant = conversation.messages.create!(role: "assistant", content: @reply, position: position + 2)
        if @summary_update
          conversation.update!(summary_text: @summary_update.fetch("text"), summary_version: conversation.summary_version + 1,
            summary_through_position: @summary_update.fetch("through_position"))
        end
        Screening::RecordApprovalsService.call(user: conversation.user, reports: @record_screening, context: :chat)
        receipt = { "message_ids" => [user_message.id, assistant.id] }
        @operation.update!(status: "accepted", result_fingerprint: fingerprint, accepted_result: receipt)
        conversation.update!(title: conversation.title == "New chat" ? @operation.message.squish.truncate(80) : conversation.title, updated_at: Time.current)
        AiTasks::UpdateTaskService.call(task: @operation.ai_task, attributes: { status: "completed", completed_at: Time.current })
        PublishUpdateService.call(conversation: conversation)
        success(receipt)
      end
    end

    private

    def valid_career_context?
      return true if @career_context.nil?
      @career_context.is_a?(Hash) && @career_context.keys.sort == %w[requirement response] &&
        @career_context.all? { |_, value| value.is_a?(String) && value.strip.present? && value == value.strip } &&
        @career_context["requirement"].length <= TextLimits::BULLET && @career_context["response"].length <= TextLimits::PROSE
    end

    def save_career_context(user)
      existing = user.career_contexts.find_by(requirement: @career_context.fetch("requirement"))
      return existing.response == @career_context.fetch("response") ? success(existing) : failure("Career context topic already exists") if existing

      CareerContexts::CreateCareerContextService.call(user: user,
        attributes: @career_context.merge("screened_fields" => %w[requirement response]))
    end

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
