# Queues an owned job reference for five fresh study questions.
# Python reads current job text and prior generated prompts when execution starts.
# Manual retry retires expired queued work while keeping existing guides and usage intact.
module StudyGuides
  class StartGuideService < ApplicationService
    def initialize(user:, job:)
      @user, @job = user, job
    end

    def call
      @expired_tasks = []
      result = AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "generate_study_guide",
        resolve_existing: method(:resolve_existing), prepare_task: method(:prepare_task))
      # Enqueue returns after its owner-lock transaction and publication attempt have finished.
      @expired_tasks.each { |task| ApiSchema.subscriptions.trigger(:ai_task_updated, { id: task.id }, task) }
      result
    end

    private

    def resolve_existing
      @cutoff = GenerationRecovery.cutoff
      return failure([ "A study guide is already being generated for this job." ]) if
        queued_guides.where(created_at: @cutoff..).exists?
      nil
    end

    def prepare_task(task)
      @job.lock!
      return failure([ "Add a job description before generating a study guide." ]) if @job.description.blank?
      previous = QuestionCollection.prompts(job: @job, user: @user)
      if previous.size > QuestionCollection::MAX_PREVIOUS_QUESTIONS || previous.sum(&:length) > QuestionCollection::MAX_PREVIOUS_CHARACTERS
        return failure([ "This job has reached the study-question generation limit. Your saved questions remain available." ])
      end
      queued_guides.where("created_at < ?", @cutoff).lock.each do |expired|
        AiTasks::UpdateTaskService.call(task: expired, attributes: { status: "failed", completed_at: Time.current,
          error_message: "This study guide took too long. A new generation was requested." })
        @expired_tasks << expired
      end
      task.subject = @job
      task.input = { "job_id" => @job.id }
      success(task)
    rescue ActiveRecord::RecordNotFound
      failure([ "This job no longer exists." ])
    end

    def queued_guides
      @user.ai_tasks.where(subject: @job, task_type: "generate_study_guide", status: "queued")
    end
  end
end
