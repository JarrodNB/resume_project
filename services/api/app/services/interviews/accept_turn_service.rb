# Commits a claimed turn as one durable outcome. Only Rails chooses message positions,
# answer counts, and progress; a replay returns the saved result without writing again.
require "digest"

module Interviews
  class AcceptTurnService < ApplicationService
    MAX_HISTORY_BYTES = 262_144
    CLOSING = "Thank you. This interview is complete.".freeze

    def initialize(operation:, attempt_id:, claim_generation:, transcript:, decision:, reply: nil,
      history_version:, model_history:)
      @operation = operation
      @attempt_id, @claim_generation = attempt_id, claim_generation
      @transcript, @decision, @reply = transcript, decision, reply
      @history_version, @model_history = history_version, model_history
    end

    # Receives an already-authorized internal operation, not a browser-supplied owner ID.
    # @return [ServiceResult<Hash>] saved acceptance receipt, including message IDs/revision
    def call
      return failure("Invalid acceptance payload") unless valid_payload?

      interview = @operation.interview_session
      interview.user.with_lock do
        interview.lock!
        @questions = interview.questions.lock.to_a
        question = @questions.find { |candidate| candidate.id == @operation.question_id }
        @operation.lock!
        fingerprint = Digest::SHA256.hexdigest(JSON.generate(canonical_payload))
        if @operation.accepted?
          next @operation.result_fingerprint == fingerprint ? success(@operation.accepted_result) : failure("Accepted result conflicts with its original payload")
        end
        next failure("Claim is stale or expired") unless current_claim?
        next failure("Interview is not active") unless interview.active? && interview.expires_at > Time.current
        next failure("Interview revision is stale") unless @operation.expected_revision == interview.revision && question.position == interview.current_question_position

        message_position = (interview.messages.maximum(:position) || -1) + 1
        answer = interview.messages.create!(question: question, kind: "answer", position: message_position,
          semantic_key: "turn:#{@operation.id}:answer", content: @transcript)
        response = save_response(interview, question, message_position + 1)
        question.update!(accepted_answer_count: question.accepted_answer_count + 1,
          history_version: @history_version, model_history: @model_history)
        interview.update!(revision: interview.revision + 1)
        interview.operations.create!(kind: "speech", question: response.question, message: response)
        receipt = { "revision" => interview.revision, "status" => interview.status,
          "message_ids" => [ answer.id, response.id ], "question_id" => question.id }
        @operation.update!(status: "accepted", accepted_at: Time.current, result_fingerprint: fingerprint, accepted_result: receipt)
        success(receipt)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def save_response(interview, question, position)
      if @decision == "advance" || question.accepted_answer_count + 1 >= interview.answer_cap
        next_question = @questions.find { |candidate| candidate.position == question.position + 1 }
        if next_question
          interview.current_question_position = next_question.position
          interview.messages.create!(question: next_question, kind: "opening", position: position,
            semantic_key: "question:#{next_question.id}:opening", content: next_question.content)
        else
          interview.status = "completed"
          interview.completed_at = Time.current
          interview.messages.create!(question: question, kind: "closing", position: position,
            semantic_key: "interview:closing", content: CLOSING)
        end
      else
        interview.messages.create!(question: question, kind: "follow_up", position: position,
          semantic_key: "turn:#{@operation.id}:reply", content: @reply)
      end
    end

    def valid_reply?
      return @reply.nil? || (@reply.is_a?(String) && @reply.length <= TextLimits::PROSE) if @decision == "advance"

      @reply.is_a?(String) && @reply.present? && @reply.length <= TextLimits::PROSE
    end

    def current_claim?
      @operation.turn? && @operation.running? && @attempt_id.present? &&
        @operation.attempt_id == @attempt_id && @operation.claim_generation == @claim_generation &&
        @operation.lease_expires_at > Time.current && @operation.execution_deadline > Time.current
    end

    def valid_payload?
      @transcript.is_a?(String) && @transcript.present? && @transcript.length <= TextLimits::PROSE &&
        %w[continue advance].include?(@decision) && valid_reply? &&
        @history_version == 1 && @model_history.is_a?(Array) && @model_history.all? { |message| message.is_a?(Hash) } &&
        JSON.generate(@model_history).bytesize <= MAX_HISTORY_BYTES
    rescue JSON::GeneratorError, JSON::NestingError
      false
    end

    def canonical_payload
      # JSON object order is irrelevant to identity, including nested history objects.
      normalize = ->(value) do
        case value
        when Hash then value.stringify_keys.sort.to_h.transform_values { |child| normalize.call(child) }
        when Array then value.map { |child| normalize.call(child) }
        else value
        end
      end
      normalize.call({ attempt_id: @attempt_id, claim_generation: @claim_generation, transcript: @transcript,
        decision: @decision, reply: @reply, history_version: @history_version, model_history: @model_history })
    end
  end
end
