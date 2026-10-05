# Description: Queues an analyze_gaps AI task comparing one job with the user's career library.
# The task input is only the job id: the AI worker reads the job and library itself (read-only
# ai_reader role, scoped to the task's user), so the analysis sees the library as it is when
# the task runs. The result stays on the AiTask, whose subject is the job.
# Index:
#   - EMPTY_LIBRARY_MESSAGE / NO_REQUIREMENTS_MESSAGE / ALREADY_RUNNING_MESSAGE: failure messages
#   - call: checks there is something to compare and nothing running, then enqueues
module GapAnalysis
  class StartGapAnalysisService < ApplicationService
    EMPTY_LIBRARY_MESSAGE = "Your career library is empty. Import a resume first, then compare it with this job.".freeze
    NO_REQUIREMENTS_MESSAGE = "This job has no requirements to compare with your career library.".freeze
    ALREADY_RUNNING_MESSAGE = "This job is already being compared with your career library.".freeze

    def initialize(user:, job:)
      @user = user
      @job = job
    end

    # Fails when there's nothing to compare or an analysis is already queued; otherwise enqueues.
    def call
      return failure([ NO_REQUIREMENTS_MESSAGE ]) if @job.requirements.empty? && @job.nice_to_haves.empty?
      return failure([ EMPTY_LIBRARY_MESSAGE ]) if career_library_empty?
      return failure([ ALREADY_RUNNING_MESSAGE ]) if analysis_running?

      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "analyze_gaps", input: { job_id: @job.id }, subject: @job)
    end

    private

    # True when the user has no experiences, projects, educations, skills, or library facts.
    # Job-only gap responses are not library content.
    def career_library_empty?
      [ @user.experiences, @user.projects, @user.educations, @user.skills, @user.library_facts ].none?(&:exists?)
    end

    # True when a recent analysis of this job is still queued (older ones count as stuck).
    def analysis_running?
      @job.ai_tasks.analyze_gaps.queued
          .where(created_at: AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago..).exists?
    end
  end
end
