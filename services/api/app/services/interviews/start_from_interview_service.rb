# Starts a new interview preparation with the same setup as one of the owner's earlier interviews,
# such as the turn-based fallback when a live room was unavailable. Rails copies the setup, saved
# job and career focus from the saved interview, so the browser sends only that interview's ID and
# nothing it shows (or leaves out) can drift from the original. The new interview gets fresh
# questions, like any start. A source whose saved job was deleted is refused rather than started
# as a different (fictional-role) interview.
module Interviews
  class StartFromInterviewService < ApplicationService
    JOB_DELETED = "The saved job for this interview was deleted. Start a new interview instead.".freeze

    def initialize(user:, source:, conversation_mode: "turn_based")
      @user, @source, @conversation_mode = user, source, conversation_mode
    end

    # @return [ServiceResult<InterviewSession>] as Interviews::StartSessionService
    def call
      return failure("Record not found") unless @source.user_id == @user.id
      return failure(JOB_DELETED) if @source.preparation_kind == "saved_job" && @source.job.nil?

      StartSessionService.call(user: @user, career_focus: @source.career_focus, setup: @source.setup_config,
        job: @source.job, conversation_mode: @conversation_mode)
    end
  end
end
