# Saves what the candidate said in answer to one live prompt (the question's opening or a
# follow-up), as the interview's normal answer message so the review, feedback and references
# work as they do for turn-based interviews. The first answer to a prompt counts toward the
# question's answers; a later report for the same prompt replaces the saved text (only the
# latest attempt is kept) without counting again. Only prompts of the current question count.
module Interviews
  class RecordLiveAnswerService < ApplicationService
    def initialize(connection:, prompt_message_id:, transcript:)
      @connection, @prompt_message_id, @transcript = connection, prompt_message_id, transcript
    end

    # @return [ServiceResult<Hash>] `{ message_id:, question_position:, accepted_answer_count:, revision: }`
    def call
      return LiveConnectionAccess.invalid_request("Invalid answer report") unless @prompt_message_id.is_a?(String) && @transcript.is_a?(String)
      return failure("Enter the answer within #{TextLimits::PROSE} characters") unless valid_transcript?

      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("The live agent has not claimed this connection") unless @connection.status == "connected"
        prompt = interview.messages.where(kind: %w[opening follow_up]).find_by(id: @prompt_message_id)
        question = prompt && interview.questions.lock.find(prompt.question_id)
        next failure("Prompt is no longer current") unless question && question.position == interview.current_question_position
        content = @transcript.strip
        answer = interview.messages.find_by(semantic_key: "live_answer:#{prompt.id}")
        if answer
          next success(receipt(answer, question, interview)) if answer.content == content
          answer.update!(content: content)
        else
          next failure("Prompt is no longer current") if interview.messages.where(question: question).where("position > ?", prompt.position).where.not(kind: "answer").exists?
          next failure("This question already has its answers") if question.accepted_answer_count >= interview.answer_cap
          answer = interview.messages.create!(question: question, kind: "answer", position: (interview.messages.maximum(:position) || -1) + 1,
            semantic_key: "live_answer:#{prompt.id}", content: content)
          question.update!(accepted_answer_count: question.accepted_answer_count + 1)
        end
        interview.update!(revision: interview.revision + 1)
        success(receipt(answer, question, interview))
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def valid_transcript?
      @transcript.strip.present? && @transcript.strip.length <= TextLimits::PROSE
    end

    def receipt(answer, question, interview)
      { message_id: answer.id, question_position: question.position, accepted_answer_count: question.accepted_answer_count,
        revision: interview.revision }
    end
  end
end
