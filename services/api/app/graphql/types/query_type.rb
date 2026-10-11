# frozen_string_literal: true

# Description: Root query fields. Everything is read through `current_user` associations, so a
# user can only ever see their own records.
# Index:
#   - interview_question_sets, interview_question_set(id:)
#   - me
#   - experiences, projects, educations, certifications, skills, library_facts (career library)
#   - jobs(stage:), job(id:)
#   - resumes, resume(id:)
#   - ai_task(id:)
module Types
  class QueryType < Types::BaseObject
    field :interview_question_sets, [ Types::InterviewQuestionSetType ], null: false
    field :interview_question_set, Types::InterviewQuestionSetType, null: false do
      argument :id, ID, required: true
    end

    field :me, Types::UserType, null: false

    field :experiences, [ Types::ExperienceType ], null: false
    field :projects, [ Types::ProjectType ], null: false
    field :educations, [ Types::EducationType ], null: false
    field :certifications, [ Types::CertificationType ], null: false
    field :skills, [ Types::SkillType ], null: false
    field :library_facts, [ Types::LibraryFactType ], null: false

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
