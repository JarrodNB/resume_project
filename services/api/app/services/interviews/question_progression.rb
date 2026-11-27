# Moves an interview from one core question to the next, the same way for every mode: the next
# question becomes current and its opening is saved with the prepared question text. Turn-based
# acceptance and skips also close a finished interview here. Callers hold the interview locks,
# choose message positions and bump the revision.
module Interviews
  module QuestionProgression
    CLOSING = "Thank you. This interview is complete.".freeze

    # @param questions [Array<InterviewSessionQuestion>] the interview's locked questions
    # @return [InterviewSessionMessage, nil] the next question's opening, or nil after the last question
    def self.open_next_question(interview, questions, question, position:, acknowledgement: nil)
      next_question = questions.find { |candidate| candidate.position == question.position + 1 }
      return nil unless next_question

      interview.current_question_position = next_question.position
      interview.messages.create!(question: next_question, kind: "opening", position: position,
        semantic_key: "question:#{next_question.id}:opening", content: next_question.content, acknowledgement: acknowledgement)
    end

    # Completes a turn-based interview after its last question with the standard closing message.
    # @return [InterviewSessionMessage] the closing
    def self.complete_with_closing(interview, question, position:, acknowledgement: nil)
      interview.status = "completed"
      interview.completed_at = Time.current
      interview.messages.create!(question: question, kind: "closing", position: position,
        semantic_key: "interview:closing", content: CLOSING, acknowledgement: acknowledgement)
    end
  end
end
