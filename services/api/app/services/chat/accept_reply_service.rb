# Accept one exact screened submission and reply atomically; conflicting or stale results cannot rewrite history.
#
# The worker may also report career-library or active saved-job fields its tools screened.
# Those `record_screening` receipts are saved through Screening::RecordApprovalsService
# with the reply after its exact claim fences. Optional generated career contexts are
# created in that same transaction; conflicts reject the entire acceptance. Only this explicit chat context allows
# taskless owned active-job approvals; unrelated taskless callers retain library-only scope.
require "digest"
module Chat
  class AcceptReplyService < ApplicationService
    include ExecutionPolicy
    def initialize(operation:, attempt_id:, claim_generation:, reply:, screened_message_sha256:, summary_update: nil, record_screening: [], career_context: nil, career_contexts: nil)
      # Keep the singular wire contract for workers deployed before batch saves.
      @career_context = career_context
      @career_contexts = career_contexts
      @contexts = career_contexts.nil? ? (career_context.nil? ? [] : [ career_context ]) : career_contexts
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
      record_identity = @record_screening.present? ? [ { "record_screening" => @record_screening } ] : []
      record_identity << { "career_context" => @career_context.sort.to_h } if @career_context
      record_identity << { "career_contexts" => @contexts.map { |entry| entry.sort.to_h } } unless @career_contexts.nil?
      fingerprint = Digest::SHA256.hexdigest(JSON.generate([ @attempt_id, @generation, @reply, @screened, summary_identity, *record_identity ]))
      with_operation_lock do |conversation|
        next(@operation.result_fingerprint == fingerprint ? success(@operation.accepted_result) : failure("Accepted result conflicts")) if @operation.accepted?
        next failure("Claim is stale or expired") unless current_claim?
        next failure("Chat revision changed") unless (conversation.messages.maximum(:position) || 0) == @operation.expected_position
        next failure("Summary version changed") unless conversation.summary_version == @operation.summary_base_version
        next failure("Summary update conflicts with the claimed context") unless valid_summary_update?(conversation)
        if @contexts.any?
          result = save_career_contexts(conversation.user)
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
        receipt = { "message_ids" => [ user_message.id, assistant.id ] }
        @operation.update!(status: "accepted", result_fingerprint: fingerprint, accepted_result: receipt)
        conversation.update!(title: conversation.title == "New chat" ? @operation.message.squish.truncate(80) : conversation.title, updated_at: Time.current)
        AiTasks::UpdateTaskService.call(task: @operation.ai_task, attributes: { status: "completed", completed_at: Time.current })
        PublishUpdateService.call(conversation: conversation)
        success(receipt)
      end
    end

    private

    def valid_career_context?
      return false if !@career_context.nil? && !@career_contexts.nil?
      return false if @career_contexts == []
      @contexts.is_a?(Array) && @contexts.length <= TextLimits::MAX_CAREER_CONTEXTS &&
        @contexts.all? { |entry| entry.is_a?(Hash) && entry.keys.sort == %w[requirement response] &&
          entry.all? { |_, value| value.is_a?(String) && value.strip.present? && value == value.strip } &&
          entry["requirement"].length <= TextLimits::BULLET && entry["response"].length <= TextLimits::PROSE } &&
        @contexts.map { |entry| entry["requirement"] }.uniq.length == @contexts.length
    end

    def save_career_contexts(user)
      existing = user.career_contexts.where(requirement: @contexts.map { |entry| entry.fetch("requirement") }).index_by(&:requirement)
      return failure("Career context topic already exists") if @contexts.any? { |entry|
        existing[entry["requirement"]] && existing[entry["requirement"]].response != entry["response"] }

      additions = @contexts.reject { |entry| existing.key?(entry["requirement"]) }
      return failure("Career context library is full") if user.career_contexts.count + additions.length > TextLimits::MAX_CAREER_CONTEXTS

      # A service validation failure must roll back earlier entries as well as jobs.
      result = success(nil)
      user.class.transaction(requires_new: true) do
        additions.each do |entry|
          result = CareerContexts::CreateCareerContextService.call(user: user,
            attributes: entry.merge("screened_fields" => %w[requirement response]))
          raise ActiveRecord::Rollback unless result.success?
        end
      end
      result
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
