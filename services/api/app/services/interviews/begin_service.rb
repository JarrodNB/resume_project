# Begins a reviewed interview once. The first question is saved under the owner lock;
# provider speech is reserved only when explicitly enabled, and executes later.
module Interviews
  class BeginService < ApplicationService
    def initialize(interview:)
      @interview = interview
    end

    # @return [ServiceResult<InterviewSession>] active interview, including safe replays
    def call
      @interview.user.with_lock do
        @interview.lock!
        next failure("Interview expired") if @interview.expired? || @interview.expires_at <= Time.current
        opening = @interview.messages.find_by(kind: "opening", position: 0)
        next success(@interview) if opening && (@interview.active? || @interview.completed?)
        next failure("Interview is not ready") unless @interview.ready?
        question = @interview.questions.lock.first
        next failure("Prepared questions unavailable") unless question
        message = @interview.messages.create!(question: question, kind: "opening", position: 0,
          semantic_key: "question:#{question.id}:opening", content: question.content)
        if SpeechPlayback.provider?(@interview)
          operation = @interview.operations.create!(kind: "speech", question: question, message: message)
          ScheduleOperationService.call(operation: operation)
        end
        @interview.update!(status: "active", revision: @interview.revision + 1)
        success(@interview)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end
