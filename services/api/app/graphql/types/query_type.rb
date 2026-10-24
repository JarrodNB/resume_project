# frozen_string_literal: true

# Root queries keep private records owner-scoped. Authenticated Job Board search
# reads shared provider listings and attaches only the current owner's saved Jobs.
# Index:
#   - interview_question_sets, interview_question_set(id:)
#   - me
#   - experiences, projects, educations, certifications, skills, library_facts (career library)
#   - jobs(stage:), job(id:)
#   - resumes, resume(id:)
#   - ai_task(id:)
module Types
  class QueryType < Types::BaseObject
    field :interview_demo_enabled, Boolean, null: false
    field :recent_interview_sessions, [ Types::InterviewSessionType ], null: false
    field :interview_session, Types::InterviewSessionType, null: false do
      argument :id, ID, required: true
    end

    def interview_demo_enabled
      !!context[:current_user] && Interviews::DemoAccess.enabled?
    end

    def interview_session(id:)
      Interviews::DemoAccess.find!(context[:current_user], id)
    end

    def recent_interview_sessions
      Interviews::DemoAccess.check!(context[:current_user])
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
      argument :remote_only, Boolean, required: false, default_value: false
      argument :cursor, String, required: false
    end

    def job_board_search(keyword:, remote_only: false, cursor: nil)
      result = JobBoard::SearchCatalogueService.call(keyword: keyword, remote_only: remote_only, cursor: cursor)
      result.value || { listings: [], next_cursor: nil, retrieved_at: nil, stale: false, errors: result.errors }
    end

    field :me, Types::UserType, null: false

    field :experiences, [ Types::ExperienceType ], null: false
    field :projects, [ Types::ProjectType ], null: false
    field :educations, [ Types::EducationType ], null: false
    field :certifications, [ Types::CertificationType ], null: false
    field :skills, [ Types::SkillType ], null: false
    field :library_facts, [ Types::LibraryFactType ], null: false
    field :library_review, Types::LibraryReviewType, null: false do
      argument :section, String, required: true
    end

    def library_review(section:)
      ::CareerLibrary::ReviewStateService.call(user: current_user, section: section).value
    end

    field :jobs, [ Types::JobType ], null: false do
      argument :stage, Types::JobStageEnum, required: false
    end
    field :job, Types::JobType, null: false do
      argument :id, ID, required: true
    end

    field :resumes, [ Types::ResumeType ], null: false
    field :resume, Types::ResumeType, null: false do
      argument :id, ID, required: true
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

    # Returns facts the user added from gap responses.
    def library_facts = current_user.library_facts

    # Returns the user's jobs, newest first, optionally filtered by stage.
    def jobs(stage: nil)
      scope = current_user.jobs.order(created_at: :desc)
      stage ? scope.where(stage: stage) : scope
    end

    # Returns one of the user's jobs.
    def job(id:) = current_user.jobs.find(id)

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
