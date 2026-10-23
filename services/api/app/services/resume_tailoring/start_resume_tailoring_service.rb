# Queues a resume draft or restores unsaved work for a job. Saved resumes block new work;
# accepted tasks remain history after deletion. Decisions share the enqueue user lock so
# concurrent starts and saves cannot create duplicate work. Publishing follows commit.
module ResumeTailoring
  class StartResumeTailoringService < ApplicationService
    ALREADY_SAVED_MESSAGE = "This job already has a saved resume.".freeze

    def initialize(user:, job:, target_page_count: 2)
      @user = user
      @job = job
      @target_page_count = target_page_count
    end

    # Returns an in-progress or unsaved tailoring task, or queues a new one.
    def call
      return failure([ "Choose 1 or 2 pages." ]) unless @target_page_count.is_a?(Integer) && [ 1, 2 ].include?(@target_page_count)

      AiTasks::EnqueueAiTaskService.call(
        user: @user,
        task_type: "tailor_resume",
        input: task_input,
        subject: @job,
        resolve_existing: method(:resolve_existing),
        prepare_task: method(:retain_retry_target)
      )
    end

    private

    def resolve_existing
      return failure([ ALREADY_SAVED_MESSAGE ]) if @user.resumes.exists?(job_id: @job.id)

      existing = @job.ai_tasks.tailor_resume.order(created_at: :desc).first
      @retry_target = existing.input.fetch("target_page_count", 2) if existing&.failed? && !existing.accepted?
      success(existing) if resumable?(existing)
    end

    # Resolve retry length under the same lock that selects existing drafts.
    def retain_retry_target(task)
      task.input["target_page_count"] = @retry_target || @target_page_count
      success(task)
    end

    # A queued task inside the in-flight window, or a complete draft not yet saved.
    def resumable?(task)
      return false unless task
      return false if task.accepted?
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
        "target_page_count" => @target_page_count,
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
