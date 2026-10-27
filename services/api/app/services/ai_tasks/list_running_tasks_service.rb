# frozen_string_literal: true

# Description: Lists a user's AI work that is still running, for the "AI work in progress" strip on
# Home. Covers every queued general task (imports, comparisons, drafts, study guides, practice
# questions, library reviews), newest first. Live mock-interview tasks are left out because they
# belong to the interview room. Work waiting on the user's answer is not running, so it is left
# out too. Reads only. Labels are safe fixed words plus the user's own job title; no prompts,
# inputs or errors are exposed.
# Index:
#   - call: returns up to LIMIT hashes of { id:, task_type:, label:, destination:, started_at: }
module AiTasks
  class ListRunningTasksService < ApplicationService
    LIMIT = 10

    # @param user [User] the signed-in user whose work is listed
    def initialize(user:)
      @user = user
    end

    # @return [ServiceResult] value is an array of running-task hashes
    def call
      tasks = @user.ai_tasks.general_ai.queued.order(created_at: :desc, id: :desc).limit(LIMIT).to_a
      job_titles = @user.jobs.where(id: tasks.select { |task| task.subject_type == "Job" }.map(&:subject_id)).pluck(:id, :title).to_h

      success(tasks.map do |task|
        label = DescribeTaskOutcomeService::LABELS.fetch(task.task_type, "AI task")
        title = job_titles[task.subject_id] if task.subject_type == "Job"
        {
          id: task.id,
          task_type: task.task_type,
          label: title ? "#{label}: #{title}" : label,
          destination: DescribeTaskOutcomeService.destination_for(task: task, user: @user, status: "queued"),
          started_at: task.created_at
        }
      end)
    end
  end
end
