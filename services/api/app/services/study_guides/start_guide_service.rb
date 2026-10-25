# Captures one owned job description and queues a guide without requiring career evidence.
# Owner locking serializes requests; the job lock makes the saved source snapshot exact.
module StudyGuides
  class StartGuideService < ApplicationService
    def initialize(user:, job:)
      @user, @job = user, job
    end

    def call
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "generate_study_guide",
        resolve_existing: method(:resolve_existing), prepare_task: method(:prepare_task))
    end

    private

    def resolve_existing
      return failure([ "A study guide is already being generated for this job." ]) if
        @user.ai_tasks.where(subject: @job, task_type: "generate_study_guide", status: "queued").exists?
      nil
    end

    def prepare_task(task)
      @job.lock!
      return failure([ "Add a job description before generating a study guide." ]) if @job.description.blank?
      task.subject = @job
      task.input = { "job_id" => @job.id, "description" => @job.description }
      success(task)
    rescue ActiveRecord::RecordNotFound
      failure([ "This job no longer exists." ])
    end
  end
end
