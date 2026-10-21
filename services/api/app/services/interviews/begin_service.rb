# Begins a reviewed interview once. The first saved question and speech reservation
# commit together under the owner lock; provider execution happens later.
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
        @interview.operations.create!(kind: "speech", question: question, message: message)
        @interview.update!(status: "active", revision: @interview.revision + 1)
        success(@interview)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end
