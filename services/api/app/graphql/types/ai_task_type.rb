# frozen_string_literal: true

# Description: An AI task's status and outcome. Message history stays server-side.
# Index:
#   - job: the Job a scrape_job or parse_job_posting task created, or the Job a gap analysis compared
module Types
  class AiTaskType < Types::BaseObject
    field :id, ID, null: false
    field :task_type, Types::AiTaskTypeEnum, null: false
    field :status, Types::AiTaskStatusEnum, null: false
    field :result, GraphQL::Types::JSON
    field :input, GraphQL::Types::JSON, null: false,
          description: "The snapshots supplied when this task was requested."
    field :pending_questions, GraphQL::Types::JSON, null: false,
          description: "Questions the AI is waiting on when status is NEEDS_USER_INPUT."
    field :error_message, String
    field :completed_at, GraphQL::Types::ISO8601DateTime
    field :accepted_at, GraphQL::Types::ISO8601DateTime,
          description: "When the user accepted the result into their data (e.g. imported a parsed resume)."
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
    field :study_guide_out_of_date, Boolean,
          description: "Whether a saved study guide uses a different description; null for other or unavailable tasks."
    field :study_guide_retry_after_seconds, Float,
          description: "Server-calculated wait before a queued guide can be manually retried; zero when available, null for other tasks."
    field :job, Types::JobType,
          description: "The job a completed scrape_job or parse_job_posting task saved, or the job an analyze_gaps task compares."

    def result
      object.result unless unavailable_clarification? || unavailable_references? || unavailable_study_guide? || unavailable_session_feedback?
    end

    def study_guide_out_of_date
      return unless object.generate_study_guide? && object.subject_type == "Job"
      job = context[:current_user].jobs.find_by(id: object.subject_id)
      return unless job
      ::StudyGuides::DescriptionSnapshot.out_of_date?(source: object.input["description"], description: job.description)
    end

    def study_guide_retry_after_seconds
      return if unavailable_study_guide?
      ::StudyGuides::GenerationRecovery.retry_after_seconds(object)
    end

    def input
      return {} if unavailable_clarification? || unavailable_references? || unavailable_study_guide? || unavailable_session_feedback?
      object.improve_library_entry? ? object.input.except("history") : object.input
    end

    def unavailable_session_feedback?
      return false unless object.interview_session_feedback?
      interview = context[:current_user].interview_sessions.find_by(id: object.subject_id)
      !interview || !interview.completed? || interview.expires_at <= Time.current || interview.content_purged_at.present?
    end

    def unavailable_study_guide?
      object.generate_study_guide? && (object.subject_type != "Job" || !context[:current_user].jobs.exists?(id: object.subject_id))
    end

    def unavailable_references?
      return false unless object.interview_references?
      record = object.user.interview_sessions.find_by(id: object.subject_id)&.career_references&.find_by(ai_task_id: object.id)
      !record || !::Interviews::ClarificationPrompt.current?(record.interview_session, record.message)
    end

    def unavailable_clarification?
      return false unless object.interview_clarification?
      clarification = object.user.interview_sessions.find_by(id: object.subject_id)&.clarifications&.find_by(ai_task_id: object.id)
      !clarification || !::Interviews::ClarificationPrompt.current?(clarification.interview_session, clarification.message)
    end

    # Returns the task's subject when it is a Job (subjects always belong to the task's user).
    def job
      object.subject if object.subject_type == "Job"
    end
  end
end
