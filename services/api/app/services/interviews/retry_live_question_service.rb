# Restarts the current live question when the candidate chooses Try again: its saved answers,
# follow-ups (with their career references and clarifications) and spoken feedback are removed
# and its answer count resets, so the new attempt replaces the old one ("only the latest answer
# is saved"). The opening stays. Each question allows two retries, counted durably here so an
# agent restart cannot add more. The agent numbers each retry; a repeat of the latest number is
# a no-op replay, so a retried request never clears the new attempt.
module Interviews
  class RetryLiveQuestionService < ApplicationService
    def initialize(connection:, question_position:, retry_number:)
      @connection, @question_position, @retry_number = connection, question_position, retry_number
    end

    # @return [ServiceResult<Hash>] `{ question_position:, retry_count:, revision: }`
    def call
      return LiveConnectionAccess.invalid_request("Invalid retry report") unless
        LiveConnectionAccess.count?(@question_position) && LiveConnectionAccess.count?(@retry_number)

      LiveConnectionAccess.with_locked(@connection) do |interview|
        next failure("The live agent has not claimed this connection") unless @connection.status == "connected"
        question = interview.questions.lock.find_by(position: @question_position)
        next failure("Question is no longer current") unless question && question.position == interview.current_question_position
        next success(receipt(question, interview)) if @retry_number == question.live_retry_count && @retry_number.positive?
        next failure("This question has no retries left") if question.live_retry_count >= InterviewSessionQuestion::LIVE_RETRY_LIMIT
        next failure("Retry is out of order") unless @retry_number == question.live_retry_count + 1

        remove_attempt(interview, question)
        question.update!(accepted_answer_count: 0, live_feedback: nil, live_retry_count: @retry_number)
        interview.update!(revision: interview.revision + 1)
        success(receipt(question, interview))
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # Destroys every message of the question except its opening. Unfinished reference or
    # clarification work for those prompts is failed first so no task waits on a deleted prompt.
    # Locks follow the documented order: messages, then their help records, then each task.
    def remove_attempt(interview, question)
      messages = interview.messages.where(question: question).where.not(kind: "opening").order(:position).lock.to_a
      message_ids = messages.map(&:id)
      records = interview.career_references.where(message_id: message_ids).order(:id).lock.to_a +
        interview.clarifications.where(message_id: message_ids).order(:id).lock.to_a
      tasks = records.map(&:ai_task)
      tasks.compact.reject(&:finished?).each do |task|
        task.with_lock do
          AiTasks::UpdateTaskService.call(task: task, attributes: { status: "failed", error_message: "question_retried", completed_at: Time.current })
        end
      end
      messages.each(&:destroy!)
    end

    def receipt(question, interview)
      { question_position: question.position, retry_count: question.live_retry_count, revision: interview.revision }
    end
  end
end
