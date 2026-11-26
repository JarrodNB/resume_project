# Saves a generated recall cue only while its answer and previous cue are unchanged.
# Runs inside the shared owner/task transaction; duplicate results never reapply.
module InterviewPrep
  class ApplyMemoryAnchorService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      return failure([ "Your answer or memory anchor changed. Generate another anchor." ]) if PracticeTaskFence.stale_reason(@task)

      question = @task.subject
      anchor = @result["memory_anchor"] if @result.is_a?(Hash)
      return failure([ "The AI couldn't produce a valid memory anchor. Try again." ]) unless anchor.is_a?(String) && anchor.strip.length.between?(1, 600)

      question.update!(memory_anchor: anchor.strip)
      success(question)
    end
  end
end
