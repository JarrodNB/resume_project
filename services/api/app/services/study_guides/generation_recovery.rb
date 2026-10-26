# Uses the shared AI in-flight window to make stuck guide work manually recoverable.
# The reader receives server-calculated remaining time instead of its own copy of the policy.
module StudyGuides
  module GenerationRecovery
    def self.cutoff
      AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago
    end

    # @return [Float, nil] remaining seconds for queued guides; zero means manual retry is available
    def self.retry_after_seconds(task)
      return unless task.generate_study_guide? && task.queued?
      [ (task.created_at - cutoff).to_f, 0.0 ].max
    end
  end
end
