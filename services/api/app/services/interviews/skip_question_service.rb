# Ends the current core-question cycle without accepting an answer or invoking AI.
# A saved identity makes a lost response safe to retry after progression or completion.
module Interviews
  class SkipQuestionService < ApplicationService
    def initialize(interview:, question_id:, expected_revision:, submission_key:)
      @interview, @question_id = interview, question_id
      @expected_revision, @submission_key = expected_revision, submission_key
    end

    # The GraphQL boundary supplies an already owner-authorized interview.
    # @return [ServiceResult<InterviewSession>] current snapshot after a durable skip
    def call
      return failure("Invalid skip request") unless @question_id.is_a?(String) && @question_id.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/) &&
        @expected_revision.is_a?(Integer) && @expected_revision >= 0 && @submission_key.is_a?(String) &&
        @submission_key.present? && @submission_key.length <= 200

      @interview.user.with_lock do
        @interview.lock!
        questions = @interview.questions.lock.to_a
        previous = questions.find { |question| question.skip_submission_key == @submission_key }
        if previous
          next previous.id == @question_id && previous.skip_expected_revision == @expected_revision ? success(@interview) : failure("Skip key conflicts with its original inputs")
        end
        next failure("Interview is not active") unless @interview.active? && @interview.expires_at > Time.current
        next failure("Interview revision is stale") unless @interview.revision == @expected_revision
        question = questions.find { |candidate| candidate.id == @question_id && candidate.position == @interview.current_question_position }
        next failure("Question is not current") unless question
        next failure("An answer is already processing") if @interview.operations.where(kind: %w[turn transcription], status: %w[pending running]).exists?

        question.update!(skipped_at: Time.current, skip_submission_key: @submission_key, skip_expected_revision: @expected_revision)
        next_question = questions.find { |candidate| candidate.position == question.position + 1 }
        position = (@interview.messages.maximum(:position) || -1) + 1
        if next_question
          message = @interview.messages.create!(question: next_question, kind: "opening", position: position,
            semantic_key: "question:#{next_question.id}:opening", content: next_question.content)
          @interview.current_question_position = next_question.position
        else
          message = @interview.messages.create!(question: question, kind: "closing", position: position,
            semantic_key: "interview:closing", content: AcceptTurnService::CLOSING)
          @interview.status = "completed"
          @interview.completed_at = Time.current
        end
        @interview.operations.create!(kind: "speech", question: message.question, message: message) if SpeechPlayback.provider?(@interview)
        @interview.update!(revision: @interview.revision + 1)
        success(@interview)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end
