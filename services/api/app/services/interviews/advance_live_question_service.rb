# Moves a live interview past its current question when the interviewer says it is moving on.
# It uses the same progression as turn-based acceptance: the next question becomes current and
# its opening is saved with the prepared text. A question left without an answer is marked
# skipped, as a turn-based skip would be. After the last question nothing moves and the
# interview stays active: the live agent's finish call completes it after its closing words.
# A retried report of the move just made returns the same result without changing anything.
module Interviews
  class AdvanceLiveQuestionService < ApplicationService
    def initialize(connection:, question_position:)
      @connection, @question_position = connection, question_position
    end

    # @return [ServiceResult<Hash>] `{ current_question_position:, revision: }`
    def call
      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("The live agent has not claimed this connection") unless @connection.status == "connected"
        questions = interview.questions.lock.to_a
        current = interview.current_question_position
        next success(receipt(interview)) if @question_position == current - 1 && advanced?(questions, current - 1)
        question = questions.find { |candidate| candidate.position == @question_position && candidate.position == current }
        next failure("Question is no longer current") unless question

        changed = false
        if question.accepted_answer_count.zero? && question.skipped_at.nil?
          question.update!(skipped_at: Time.current)
          changed = true
        end
        position = (interview.messages.maximum(:position) || -1) + 1
        changed = true if QuestionProgression.open_next_question(interview, questions, question, position: position)
        interview.update!(revision: interview.revision + 1) if changed
        success(receipt(interview))
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # The previous question was left behind by an advance (answered or skipped), not still open.
    def advanced?(questions, position)
      question = questions.find { |candidate| candidate.position == position }
      question && (question.accepted_answer_count.positive? || question.skipped_at.present?)
    end

    def receipt(interview)
      { current_question_position: interview.current_question_position, revision: interview.revision }
    end
  end
end
