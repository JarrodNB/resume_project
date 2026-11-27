# Saves what the live interviewer just asked as the interview's normal prompt message, so the
# snapshot, review and career references work as they do for turn-based interviews. Only the
# opening of the current question is handled for now. Safe to repeat: a saved opening is
# returned as it is, never duplicated or overwritten.
module Interviews
  class RecordLivePromptService < ApplicationService
    KINDS = %w[opening].freeze

    def initialize(connection:, question_position:, kind:, text:)
      @connection, @question_position, @kind, @text = connection, question_position, kind, text
    end

    # @return [ServiceResult<Hash>] `{ message_id:, question_position:, revision: }`
    def call
      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("The live agent has not claimed this connection") unless @connection.status == "connected"
        next failure("Unsupported prompt kind") unless KINDS.include?(@kind)
        question = interview.questions.find_by(position: @question_position)
        next failure("Question is no longer current") unless question && question.position == interview.current_question_position
        existing = interview.messages.find_by(question: question, kind: "opening")
        next success(receipt(existing, interview)) if existing
        next failure("Enter the spoken prompt within #{TextLimits::PROSE} characters") unless valid_text?
        message = interview.messages.create!(question: question, kind: "opening",
          position: (interview.messages.maximum(:position) || -1) + 1,
          semantic_key: "question:#{question.id}:opening", content: @text.strip)
        interview.update!(revision: interview.revision + 1)
        success(receipt(message, interview))
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def valid_text?
      @text.is_a?(String) && @text.strip.present? && @text.strip.length <= TextLimits::PROSE
    end

    def receipt(message, interview)
      { message_id: message.id, question_position: message.question.position, revision: interview.revision }
    end
  end
end
