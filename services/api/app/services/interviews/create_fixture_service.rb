# Creates fictional interview context, its first accepted opening, and saved-text speech
# work and fallback delivery in one transaction. Provider/storage work runs later.
module Interviews
  class CreateFixtureService < ApplicationService
    OPENINGS = [
      "Tell me about a time you helped a team solve a difficult problem.",
      "How did you decide what to work on first?"
    ].freeze

    def initialize(user:, question_count: 1, execution_mode: "fake")
      @user, @question_count, @execution_mode = user, question_count, execution_mode
    end

    # @return [ServiceResult<InterviewSession>] committed fixture with one pending opening speech
    def call
      return failure("Fixture must contain one or two questions") unless [ 1, 2 ].include?(@question_count)

      configuration = ExecutionConfiguration::PRESETS[@execution_mode]
      return failure("Interview execution mode unavailable") unless configuration

      @user.with_lock do
        interview = @user.interview_sessions.create!(
          execution_mode: @execution_mode, execution_config: configuration,
          fixture_context: { synthetic: true, version: 1, role: "Fictional software engineer", career: "Built a small team scheduling tool." },
          expires_at: 7.days.from_now
        )
        questions = OPENINGS.first(@question_count).each_with_index.map do |content, position|
          interview.questions.create!(content: content, position: position)
        end
        question = questions.first
        message = interview.messages.create!(question: question, kind: "opening", position: 0,
          semantic_key: "question:#{question.id}:opening", content: question.content)
        operation = interview.operations.create!(kind: "speech", question: question, message: message)
        ScheduleOperationService.call(operation: operation) if SpeechPlayback.provider?(interview)
        success(interview)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end
