# Saves a complete fictional role and question plan once. A stale executor cannot replace
# prepared content, and lost acceptance replies resolve to the original durable receipt.
require "digest"

module Interviews
  class AcceptPreparationService < ApplicationService
    include ExecutionPolicy
    QUESTION_TYPES = %w[behavioral technical knowledge].freeze

    def initialize(operation:, attempt_id:, claim_generation:, role:, questions:)
      @operation, @attempt_id, @generation = operation, attempt_id, claim_generation
      @role, @questions = role, questions
    end

    # @return [ServiceResult<Hash>] ready-state receipt; creates no opening or speech work
    def call
      return failure("Invalid prepared interview") unless valid_output?
      fingerprint = Digest::SHA256.hexdigest(JSON.generate(canonical({ role: @role, questions: @questions })))
      with_operation_lock do |interview|
        next failure("Interview expired") if interview.expired? || interview.expires_at <= Time.current
        next failure("Not preparation work") unless @operation.preparation?
        if @operation.accepted?
          next @operation.result_fingerprint == fingerprint ? success(@operation.accepted_result) : failure("Prepared result conflicts")
        end
        next failure("Claim is stale or expired") unless current_claim?
        next failure("Preparation is no longer active") unless interview.preparing? && interview.questions.empty?
        @questions.each_with_index do |question, position|
          interview.questions.create!(content: question.fetch("content"), question_type: question.fetch("question_type"), position: position)
        end
        interview.update!(status: "ready", prepared_role: @role, revision: interview.revision + 1)
        receipt = { "interview_id" => interview.id, "status" => "ready", "revision" => interview.revision }
        @operation.update!(status: "accepted", accepted_at: Time.current, result_fingerprint: fingerprint, accepted_result: receipt)
        @operation.ai_task&.update!(status: "completed", completed_at: Time.current)
        success(receipt)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def valid_output?
      return false unless @role.is_a?(Hash) && @role.keys.sort == %w[requirements responsibilities title] &&
        prose?(@role["title"], 120) && %w[responsibilities requirements].all? { |key| @role[key].is_a?(Array) && @role[key].size.between?(1, 6) && @role[key].all? { |item| prose?(item, 200) } }
      return false unless @questions.is_a?(Array) && @questions.size == 9
      return false unless @questions.each_with_index.all? { |question, index| question.is_a?(Hash) && question.keys.sort == %w[content question_type] && question["question_type"] == QUESTION_TYPES[index % 3] && prose?(question["content"], 400) }
      @questions.map { |question| question["content"].downcase.gsub(/\s+/, " ").strip }.uniq.size == 9
    end

    def prose?(value, limit)
      value.is_a?(String) && value.present? && value.length <= limit
    end

    def canonical(value)
      case value
      when Hash then value.stringify_keys.sort.to_h.transform_values { |child| canonical(child) }
      when Array then value.map { |child| canonical(child) }
      else value
      end
    end
  end
end
