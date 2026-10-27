# Description: Queues a parse_job_posting AI task for a job advertisement the user pasted.
# The worker extracts a title, company, and requirement lines; Jobs::CreateJobFromPostingService
# saves the Job when the result arrives.
# Index:
#   - BLANK_MESSAGE / TOO_LONG_MESSAGE: shown when the paste can't be queued
#   - call: checks the paste, enqueues; returns the AiTask
module Jobs
  class StartJobPostingParseService < ApplicationService
    BLANK_MESSAGE = "Paste the job ad.".freeze
    TOO_LONG_MESSAGE = "This job ad is too long. Shorten it and try again.".freeze

    def initialize(user:, text:)
      @user = user
      @text = text.to_s.strip
    end

    # Rejects a blank or oversized paste, then enqueues the task with the ad text.
    def call
      return failure([ BLANK_MESSAGE ]) if @text.blank?
      return failure([ TOO_LONG_MESSAGE ]) if @text.length > TextLimits::JOB_DESCRIPTION

      AiTasks::EnqueueAiTaskService.call(
        user: @user, task_type: "parse_job_posting", input: { text: @text }
      )
    end
  end
end
