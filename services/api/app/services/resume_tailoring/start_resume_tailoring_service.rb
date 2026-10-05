# Description: Queues a tailor_resume task for one job, or returns the task already in progress.
# Contact is snapshotted from the profile. The worker reads the library itself.
# Index:
#   - NEEDS_COMPARISON_MESSAGE / ALREADY_SAVED_MESSAGE: failure messages
#   - call: returns the task to follow
module ResumeTailoring
  class StartResumeTailoringService < ApplicationService
    NEEDS_COMPARISON_MESSAGE = "Compare this job with your career library before writing a resume.".freeze
    ALREADY_SAVED_MESSAGE = "This job already has a saved resume.".freeze

    def initialize(user:, job:)
      @user = user
      @job = job
    end

    # Returns an in-progress or unsaved tailoring task, or queues a new one.
    def call
      existing = @job.latest_tailoring
      return failure([ ALREADY_SAVED_MESSAGE ]) if existing&.accepted?
      return success(existing) if resumable?(existing)

      analysis = latest_completed_analysis
      return failure([ NEEDS_COMPARISON_MESSAGE ]) unless analysis

      AiTasks::EnqueueAiTaskService.call(
        user: @user,
        task_type: "tailor_resume",
        input: task_input(analysis),
        subject: @job
      )
    end

    private

    # A queued task still inside the in-flight window, a pause, or a finished draft not yet saved.
    def resumable?(task)
      return false unless task
      return true if task.needs_user_input? || (task.completed? && !task.accepted?)

      task.queued? && task.created_at >= AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago
    end

    # The newest completed comparison, whose result the prompt quotes.
    def latest_completed_analysis
      @job.ai_tasks.analyze_gaps.completed.order(created_at: :desc).first
    end

    # What the worker needs that it cannot read itself (profile contact, the comparison, answers).
    def task_input(analysis)
      {
        "job_id" => @job.id,
        "generation" => 0,
        "contact" => {
          "full_name" => @user.name,
          "email" => @user.contact_email,
          "phone" => @user.phone,
          "location" => @user.location,
          "links" => @user.links
        },
        "gap_analysis" => analysis.result&.dig("gap_analysis"),
        "gap_responses" => @job.gap_responses.map { |response| { "requirement" => response.requirement, "body" => response.body } },
        "approved_sections" => [],
        "pending_section" => nil
      }
    end
  end
end
