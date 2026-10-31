# Queues a resume draft or restores unsaved work for a job. Saved resumes block new work;
# accepted tasks remain history after deletion. Decisions share the enqueue user lock so
# concurrent starts and saves cannot create duplicate work. Publishing follows commit.
module ResumeTailoring
  class StartResumeTailoringService < ApplicationService
    ALREADY_SAVED_MESSAGE = "This job already has a saved resume.".freeze
    EDITABLE_SECTION_TYPES = %w[contact summary experience projects education certifications skills].freeze

    def initialize(user:, job:)
      @user = user
      @job = job
    end

    # Returns an in-progress or unsaved tailoring task, or queues a new one.
    def call
      AiTasks::EnqueueAiTaskService.call(
        user: @user,
        task_type: "tailor_resume",
        input: task_input,
        subject: @job,
        resolve_existing: method(:resolve_existing),
        prepare_task: method(:set_summary_inclusion)
      )
    end

    private

    # Enqueue has reloaded and locked the owner, so concurrent preference changes cannot
    # leave a new task with the stale default from a previously loaded User instance.
    def set_summary_inclusion(task)
      task.input = task.input.merge("include_summary" => @user.include_summary)
      success(task)
    end

    def resolve_existing
      return failure([ ALREADY_SAVED_MESSAGE ]) if @user.resumes.exists?(job_id: @job.id)

      existing = @job.ai_tasks.tailor_resume.order(created_at: :desc).first
      success(existing) if resumable?(existing)
    end

    # A queued task inside the in-flight window, or a draft with a section the browser can edit.
    def resumable?(task)
      return false unless task
      return false if task.accepted?
      if task.completed?
        sections = task.result.is_a?(Hash) ? task.result["sections"] : nil
        return sections.is_a?(Array) && sections.any? { |section|
          section.is_a?(Hash) && EDITABLE_SECTION_TYPES.include?(section["section_type"]) &&
            section["omitted"] != true && section["content"].is_a?(Hash)
        }
      end

      task.queued? && task.created_at >= AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago
    end

    # The newest completed comparison, whose result the prompt quotes.
    def latest_completed_analysis
      @job.ai_tasks.analyze_gaps.completed.order(created_at: :desc).first
    end

    # Keep only the selected comparison identity. Python reads current owned sources.
    def task_input
      { "job_id" => @job.id, "analysis_task_id" => latest_completed_analysis&.id }
    end
  end
end
