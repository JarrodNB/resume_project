# frozen_string_literal: true

# Description: Works out the one suggested next step for each of a user's saved jobs, for the
# Home page pipeline. Reads only; it never changes jobs or tasks. Uses three queries no matter
# how many jobs there are: the jobs, each job's newest comparison and resume-writing task, and
# which jobs already have a saved resume. Only the user's own tasks and resumes count.
# Index:
#   - call: returns [{ job:, next_step: }] newest job first
#   - next_step_for: the pure rule that picks a step from a job's stage, tasks and resume flag
module Jobs
  class BuildPipelineService < ApplicationService
    NEXT_STEPS = %w[
      comparison_running resume_running comparison_failed resume_failed review_resume_draft
      compare write_resume ready_to_apply awaiting_response practice_interview none
    ].freeze
    PIPELINE_TASK_TYPES = %w[analyze_gaps tailor_resume].freeze
    IN_PROGRESS_STATUSES = %w[queued needs_user_input].freeze

    # @param user [User] the signed-in user whose jobs are summarized
    def initialize(user:)
      @user = user
    end

    # @return [ServiceResult] value is an array of { job: Job, next_step: String }
    def call
      jobs = @user.jobs.active.order(created_at: :desc, id: :desc).to_a
      return success([]) if jobs.empty?

      job_ids = jobs.map(&:id)
      latest_tasks = latest_tasks_by_job(job_ids)
      job_ids_with_resume = @user.resumes.where(job_id: job_ids).distinct.pluck(:job_id).to_set

      entries = jobs.map do |job|
        tasks = latest_tasks.fetch(job.id, {})
        step = self.class.next_step_for(stage: job.stage, latest_gap_analysis: tasks["analyze_gaps"],
          latest_tailoring: tasks["tailor_resume"], has_resume: job_ids_with_resume.include?(job.id))
        { job: job, next_step: step }
      end
      success(entries)
    end

    # Picks the single next step for one job. The first matching rule wins: running or failed
    # AI work comes first, then an unreviewed resume draft, then the job's stage.
    #
    # @param stage [String] one of Job::STAGES
    # @param latest_gap_analysis [AiTask, nil] the job's newest analyze_gaps task
    # @param latest_tailoring [AiTask, nil] the job's newest tailor_resume task
    # @param has_resume [Boolean] whether a resume is saved for the job
    # @return [String] one of NEXT_STEPS
    def self.next_step_for(stage:, latest_gap_analysis:, latest_tailoring:, has_resume:)
      gap_status = latest_gap_analysis&.status
      # A saved resume makes any older tailoring task irrelevant.
      tailoring = has_resume ? nil : latest_tailoring
      tailoring_status = tailoring&.status

      return "comparison_running" if IN_PROGRESS_STATUSES.include?(gap_status)
      return "resume_running" if IN_PROGRESS_STATUSES.include?(tailoring_status)
      return "comparison_failed" if gap_status == "failed"
      return "resume_failed" if tailoring_status == "failed"
      return "review_resume_draft" if tailoring_status == "completed" && tailoring.accepted_at.nil?

      case stage
      when "unapplied"
        if gap_status != "completed" then "compare"
        elsif !has_resume then "write_resume"
        else "ready_to_apply"
        end
      when "applied" then "awaiting_response"
      when "interviewing" then "practice_interview"
      else "none"
      end
    end

    private

    # Returns { job_id => { task_type => newest AiTask } } using Postgres DISTINCT ON. Loads only
    # the columns the rule reads, so large task results stay in the database.
    def latest_tasks_by_job(job_ids)
      tasks = @user.ai_tasks
        .where(subject_type: "Job", subject_id: job_ids, task_type: PIPELINE_TASK_TYPES)
        .select("DISTINCT ON (ai_tasks.subject_id, ai_tasks.task_type) ai_tasks.id, ai_tasks.subject_id, " \
          "ai_tasks.task_type, ai_tasks.status, ai_tasks.accepted_at, ai_tasks.created_at")
        .reorder(Arel.sql("ai_tasks.subject_id, ai_tasks.task_type, ai_tasks.created_at DESC, ai_tasks.id DESC"))

      tasks.each_with_object(Hash.new { |hash, key| hash[key] = {} }) do |task, by_job|
        by_job[task.subject_id][task.task_type] = task
      end
    end
  end
end
