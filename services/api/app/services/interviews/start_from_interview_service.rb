# Starts a new interview preparation with the same setup as one of the owner's earlier interviews,
# such as the turn-based fallback when a live room was unavailable. Rails copies the setup, saved
# job and career focus from the saved interview, so the browser sends only that interview's ID and
# nothing it shows (or leaves out) can drift from the original. The new interview gets fresh
# questions, like any start. A source whose saved job was deleted is refused rather than started
# as a different (fictional-role) interview.
#
# When a turn-based interview starts from an unfinished live session, that live session is
# finished in the same request, as Interviews::FinishLiveService.for_owner does for an
# unavailable room: a joined room ends as `failed` and a never-joined session is abandoned, so it
# never stays active. The new interview starts first, so a refused start leaves the live session
# as it was (the candidate can still rejoin it). A finish that fails is logged; the new interview
# still stands.
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

      result = StartSessionService.call(user: @user, career_focus: @source.career_focus, setup: @source.setup_config,
        job: @source.job, conversation_mode: @conversation_mode)
      finish_live_source if result.success? && @conversation_mode == "turn_based"
      result
    end

    private

    def finish_live_source
      return unless @source.conversation_live? && %w[preparing ready active].include?(@source.status)

      finished = FinishLiveService.for_owner(interview: @source, live_unavailable: true)
      Rails.logger.warn("Live session #{@source.id} was not finished for its turn-based fallback: #{finished.errors.join(', ')}") unless finished.success?
    end
  end
end
