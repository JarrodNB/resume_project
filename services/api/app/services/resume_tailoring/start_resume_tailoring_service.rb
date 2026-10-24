# Queues a resume draft or restores unsaved work for a job. Saved resumes block new work;
# accepted tasks remain history after deletion. Decisions share the enqueue user lock so
# concurrent starts and saves cannot create duplicate work. Publishing follows commit.
module ResumeTailoring
  class StartResumeTailoringService < ApplicationService
    ALREADY_SAVED_MESSAGE = "This job already has a saved resume.".freeze

    def initialize(user:, job:, target_pages: 1)
      @user = user
      @job = job
      @target_pages = target_pages
    end

    # Returns an in-progress or unsaved tailoring task, or queues a new one.
    def call
      AiTasks::EnqueueAiTaskService.call(
        user: @user,
        task_type: "tailor_resume",
        input: task_input,
        subject: @job,
        resolve_existing: method(:resolve_existing),
        prepare_task: method(:prepare_task)
      )
    end

    private

    def prepare_task(task)
      task.input = task_input.merge("target_pages" => @target_pages)
      success(task)
    end

    def resolve_existing
      return failure([ ALREADY_SAVED_MESSAGE ]) if @user.resumes.exists?(job_id: @job.id)

      existing = @job.ai_tasks.tailor_resume.order(created_at: :desc).first
      return success(existing) if resumable?(existing)

      return failure([ "Choose one or two target pages." ]) unless [ 1, 2 ].include?(@target_pages)
      if @target_pages == 2 && !ResumePageEligibilityService.call(user: @user).value
        return failure([ "Two pages need at least 700 words of career-library descriptions and accomplishments. Add more detail or choose one page." ])
      end
      nil
    end

    # A queued task inside the in-flight window, or a complete draft not yet saved.
    def resumable?(task)
      return false unless task
      return false if task.accepted?
      return task.result.is_a?(Hash) && task.result["markdown"].is_a?(String) && [ 1, 2 ].include?(task.result["target_pages"]) if task.completed?

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
