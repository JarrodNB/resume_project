# Creates fictional interview context, its first accepted opening, and saved-text speech
# work in one transaction. Nothing calls providers, queues, or storage here.
module Interviews
  class CreateFixtureService < ApplicationService
    OPENINGS = [
      "Tell me about a time you helped a team solve a difficult problem.",
      "How did you decide what to work on first?"
    ].freeze

    def initialize(user:, question_count: 1)
      @user, @question_count = user, question_count
    end

    # @return [ServiceResult<InterviewSession>] committed demo with one pending opening speech
    def call
      return failure("Fixture must contain one or two questions") unless [ 1, 2 ].include?(@question_count)

      @user.with_lock do
        interview = @user.interview_sessions.create!(
          fixture_context: { synthetic: true, version: 1, role: "Fictional software engineer", career: "Built a small team scheduling tool." },
          expires_at: 7.days.from_now
        )
        questions = OPENINGS.first(@question_count).each_with_index.map do |content, position|
          interview.questions.create!(content: content, position: position)
        end
        question = questions.first
        message = interview.messages.create!(question: question, kind: "opening", position: 0,
          semantic_key: "question:#{question.id}:opening", content: question.content)
        interview.operations.create!(kind: "speech", question: question, message: message)
        success(interview)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end
