# Saves what the live interviewer just asked as the interview's normal prompt message, so the
# snapshot, review and career references work as they do for turn-based interviews.
#
# An opening saves the prepared question text (like turn-based BeginService), not the spoken
# words, so a cut-off or reworded opening never changes the saved question; a repeat returns
# the saved opening. A follow-up saves the interviewer's spoken words. It is allowed only once
# the latest prompt for the current question has an answer and while the question has fewer
# than the interview's answer cap of answers. The agent names each follow-up with its own
# `prompt_key`, so a retried request returns the saved follow-up instead of adding another.
module Interviews
  class RecordLivePromptService < ApplicationService
    KINDS = %w[opening follow_up].freeze
    PROMPT_KEY_LIMIT = 100

    def initialize(connection:, question_position:, kind:, text:, prompt_key: nil)
      @connection, @question_position, @kind, @text, @prompt_key = connection, question_position, kind, text, prompt_key
    end

    # @return [ServiceResult<Hash>] `{ message_id:, question_position:, revision: }`
    def call
      return LiveConnectionAccess.invalid_request("Invalid prompt report") unless well_formed?

      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("The live agent has not claimed this connection") unless @connection.status == "connected"
        question = interview.questions.lock.find_by(position: @question_position)
        next failure("Question is no longer current") unless question && question.position == interview.current_question_position
        @kind == "opening" ? save_opening(interview, question) : save_follow_up(interview, question)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def save_opening(interview, question)
      existing = interview.messages.find_by(question: question, kind: "opening")
      return success(receipt(existing, interview)) if existing

      create_prompt(interview, question, kind: "opening", semantic_key: "question:#{question.id}:opening", content: question.content)
    end

    def save_follow_up(interview, question)
      return failure("Follow-ups need a prompt key within #{PROMPT_KEY_LIMIT} characters") unless valid_prompt_key?
      existing = interview.messages.find_by(semantic_key: "live_prompt:#{@prompt_key}")
      if existing
        return existing.follow_up? && existing.question_id == question.id ? success(receipt(existing, interview)) : failure("Prompt key conflicts with its original prompt")
      end
      return failure("Enter the spoken prompt within #{TextLimits::PROSE} characters") unless valid_text?
      latest = interview.messages.where(question: question).order(:position).last
      return failure("The latest prompt has no answer yet") unless latest&.answer?
      return failure("No more follow-ups for this question") if question.accepted_answer_count >= interview.answer_cap

      create_prompt(interview, question, kind: "follow_up", semantic_key: "live_prompt:#{@prompt_key}", content: @text.strip)
    end

    def create_prompt(interview, question, kind:, semantic_key:, content:)
      message = interview.messages.create!(question: question, kind: kind,
        position: (interview.messages.maximum(:position) || -1) + 1, semantic_key: semantic_key, content: content)
      interview.update!(revision: interview.revision + 1)
      success(receipt(message, interview))
    end

    def well_formed?
      LiveConnectionAccess.count?(@question_position) && KINDS.include?(@kind) &&
        (@text.nil? || @text.is_a?(String)) && (@prompt_key.nil? || @prompt_key.is_a?(String))
    end

    def valid_prompt_key?
      @prompt_key.is_a?(String) && @prompt_key.present? && @prompt_key.length <= PROMPT_KEY_LIMIT
    end

    def valid_text?
      @text.is_a?(String) && @text.strip.present? && @text.strip.length <= TextLimits::PROSE
    end

    def receipt(message, interview)
      { message_id: message.id, question_position: message.question.position, revision: interview.revision }
    end
  end
end
