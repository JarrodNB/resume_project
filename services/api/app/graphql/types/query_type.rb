# frozen_string_literal: true

# Root queries keep private records, including saved chat history, owner-scoped. Authenticated Job Board search
# reads shared provider listings and attaches only the current owner's saved Jobs.
# Index:
#   - interview_session, recent_interview_sessions
#   - interview_question_sets, interview_question_set(id:)
#   - me
#   - experiences, projects, educations, certifications, skills, career_contexts (career library)
#   - jobs(stage:), job(id:), job_pipeline (each job's suggested next step)
#   - resumes, resume(id:)
#   - ai_task(id:)
module Types
  class QueryType < Types::BaseObject
    field :chat_settings, Types::ChatSettingsType, null: false
    field :chat_conversations, Types::ChatConversationPageType, null: false do
      argument :cursor, String, required: false
    end

    def chat_conversations(cursor: nil)
      raise GraphQL::ExecutionError, "Authentication required" unless current_user

      result = ::Chat::ListConversationsService.call(user: current_user, cursor: cursor)
      result.value || { conversations: [], next_cursor: nil, errors: result.errors }
    end

    field :chat_conversation, Types::ChatConversationType, null: false do
      argument :id, ID, required: true
    end

    def chat_settings
      raise GraphQL::ExecutionError, "Authentication required" unless current_user

      { max_input_characters: ChatLimits::MAX_INPUT_CHARACTERS,
        summarize_every_user_messages: ChatLimits::SUMMARIZE_EVERY_USER_MESSAGES }
    end

    def chat_conversation(id:)
      raise GraphQL::ExecutionError, "Authentication required" unless current_user

      current_user.chat_conversations.find(id)
    end

    field :interviews_enabled, Boolean, null: false
    field :recent_interview_sessions, [ Types::InterviewSessionType ], null: false
    field :interview_session, Types::InterviewSessionType, null: false do
      argument :id, ID, required: true
    end

    def interviews_enabled
      !!context[:current_user] && Interviews::Access.enabled?
    end

    def interview_session(id:)
      Interviews::Access.find!(context[:current_user], id)
    end

    def recent_interview_sessions
      Interviews::Access.check!(context[:current_user])
      context[:current_user].interview_sessions.where(execution_mode: "real",
        status: %w[preparing ready active completed]).where("expires_at > ?", Time.current)
        .order(created_at: :desc, id: :desc).limit(20)
    end

    field :interview_question_sets, [ Types::InterviewQuestionSetType ], null: false
    field :interview_question_set, Types::InterviewQuestionSetType, null: false do
      argument :id, ID, required: true
    end

    field :job_board_search, Types::JobBoardSearchPageType, null: false do
      argument :keyword, String, required: true
      argument :filters, Types::JobBoardFiltersInput, required: false
      argument :experience_levels, [ Types::JobBoardExperienceLevelEnum ], required: false, default_value: []
      argument :remote_only, Boolean, required: false, default_value: false
      argument :cursor, String, required: false
    end

    def job_board_search(keyword:, remote_only: false, cursor: nil, experience_levels: [], filters: nil)
      result = JobBoard::SearchCatalogueService.call(keyword: keyword, remote_only: remote_only, experience_levels: experience_levels, cursor: cursor, filters: filters&.to_h || {})
      result.value || { listings: [], next_cursor: nil, retrieved_at: nil, stale: false, errors: result.errors }
    end

    field :job_board_locations, Types::JobBoardLocationsPageType, null: false do
      argument :query, String, required: true
    end

    def job_board_locations(query:)
      result = JobBoard::SuggestLocationsService.call(query: query)
      result.value || { locations: [], errors: result.errors }
    end

    field :me, Types::UserType, null: false

    field :experiences, [ Types::ExperienceType ], null: false
    field :projects, [ Types::ProjectType ], null: false
    field :educations, [ Types::EducationType ], null: false
    field :certifications, [ Types::CertificationType ], null: false
    field :skills, [ Types::SkillType ], null: false
    field :career_contexts, [ Types::CareerContextType ], null: false
    field :library_review, Types::LibraryReviewType, null: false do
      argument :section, String, required: true
    end

    def library_review(section:)
      ::CareerLibrary::ReviewStateService.call(user: current_user, section: section).value
    end

    field :summary_generation, Types::SummaryGenerationType, null: false do
      argument :target_kind, String, required: true
      argument :target_id, ID, required: false
    end

    def summary_generation(**arguments)
      result = ::SummaryGeneration::ReadStateService.call(user: current_user, **arguments)
      raise GraphQL::ExecutionError, result.errors.join(", ") unless result.success?
      result.value
    end

    field :library_edit, Types::LibraryEditType, null: false do
      argument :kind, String, required: true
      argument :record_id, ID, required: true
    end

    def library_edit(kind:, record_id:)
      ::CareerLibrary::EditStateService.call(user: current_user, kind: kind, record_id: record_id).value
    end

    field :jobs, [ Types::JobType ], null: false do
      argument :stage, Types::JobStageEnum, required: false
    end
    field :job, Types::JobType, null: false do
      argument :id, ID, required: true
    end
    field :job_pipeline, [ Types::JobPipelineEntryType ], null: false,
          description: "The signed-in user's jobs, newest first, each with its one suggested next step."

    field :running_ai_tasks, [ Types::RunningAiTaskType ], null: false,
          description: "The signed-in user's AI work still in progress, newest first (live interview work excluded)."

    field :resumes, [ Types::ResumeType ], null: false
    field :resume, Types::ResumeType, null: false do
      argument :id, ID, required: true
    end

    field :task_outcomes, Types::AiTaskOutcomePageType, null: false do
      argument :after, String, required: true
      argument :through, String, required: true
      argument :limit, Integer, required: false, default_value: 100
    end

    # Recovers only the authenticated owner's committed terminal occurrences.
    def task_outcomes(after:, through:, limit: 100)
      raise GraphQL::ExecutionError, "Authentication required" unless current_user
      result = AiTasks::ListTaskOutcomesService.call(outcomes: current_user.ai_task_outcomes,
        after: after, through: through, limit: limit)
      raise GraphQL::ExecutionError, result.errors.join(", ") unless result.success?
      result.value
    end

    field :ai_task, Types::AiTaskType, null: false do
      argument :id, ID, required: true
    end

    # Returns practice sets belonging to the signed-in user, newest first.
    def interview_question_sets = current_user.interview_question_sets.includes(:questions)

    # Returns one authorized practice set with ordered questions.
    def interview_question_set(id:) = current_user.interview_question_sets.find(id)

    # Returns the signed-in user.
    def me = current_user

    # Returns the user's experiences with highlights preloaded.
    def experiences = current_user.experiences.includes(:highlights)

    # Returns the user's projects.
    def projects = current_user.projects

    # Returns the user's education entries.
    def educations = current_user.educations

    # Returns the user's independent certification entries.
    def certifications = current_user.certifications

    # Returns the user's skills.
    def skills = current_user.skills

    # Returns career context the user added from gap responses.
    def career_contexts = current_user.career_contexts

    # Returns the user's jobs, newest first, optionally filtered by stage.
    def jobs(stage: nil)
      scope = current_user.jobs.active.order(created_at: :desc)
      stage ? scope.where(stage: stage) : scope
    end

    # Returns one of the user's jobs.
    def job(id:) = current_user.jobs.find(id)

    # Returns the user's jobs with their suggested next steps, in a fixed number of queries.
    def job_pipeline
      raise GraphQL::ExecutionError, "Authentication required" unless current_user
      Jobs::BuildPipelineService.call(user: current_user).value
    end

    def running_ai_tasks
      raise GraphQL::ExecutionError, "Authentication required" unless current_user
      AiTasks::ListRunningTasksService.call(user: current_user).value
    end

    # Returns the user's resumes, most recently updated first.
    def resumes = current_user.resumes.includes(:job, :sections).order(updated_at: :desc)

    # Returns one of the user's resumes.
    def resume(id:) = current_user.resumes.find(id)

    # Returns one of the user's AI tasks.
    def ai_task(id:) = current_user.ai_tasks.find(id)

    private

    # Returns the authenticated user from context.
    def current_user
      context[:current_user]
    end
  end
end
