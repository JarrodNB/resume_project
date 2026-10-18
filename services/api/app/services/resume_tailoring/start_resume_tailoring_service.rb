# Description: Queues a tailor_resume task for one job, or returns the task already in progress.
# Contact is snapshotted from the profile. A finished comparison is attached when one exists.
# The worker reads the library itself.
# Index:
#   - ALREADY_SAVED_MESSAGE: failure message
#   - call: returns the task to follow
module ResumeTailoring
  class StartResumeTailoringService < ApplicationService
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

      AiTasks::EnqueueAiTaskService.call(
        user: @user,
        task_type: "tailor_resume",
        input: task_input,
        subject: @job
      )
    end

    private

    # A queued task inside the in-flight window, or a complete draft not yet saved.
    def resumable?(task)
      return false unless task
      return true if task.completed? && !task.accepted?

      task.queued? && task.created_at >= AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago
    end

    # The newest completed comparison, whose result the prompt quotes.
    def latest_completed_analysis
      @job.ai_tasks.analyze_gaps.completed.order(created_at: :desc).first
    end

    # Profile contact, the comparison, and answers. The worker reads name, contact email, and
    # phone so it can mask them; location and links still come from this snapshot.
    def task_input
      analysis = latest_completed_analysis
      {
        "job_id" => @job.id,
        "contact" => {
          "full_name" => @user.name,
          "email" => @user.contact_email,
          "phone" => @user.phone,
          "location" => @user.location,
          "links" => @user.links
        },
        "gap_analysis" => analysis&.result&.dig("gap_analysis"),
        "gap_responses" => @job.gap_responses.map { |response| { "requirement" => response.requirement, "body" => response.body } }
      }
    end
  end
end
