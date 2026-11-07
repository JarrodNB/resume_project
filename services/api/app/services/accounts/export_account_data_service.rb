# Builds a copy of everything a user wrote or saved, so they can download their data.
# Lists fields explicitly so password hashes, session data, screening receipts, embeddings
# and internal AI bookkeeping never leak into the file. Uploaded resume files are not
# included (their parsed contents are already in the career library), and spoken interviews
# appear only until their content expires.
module Accounts
  class ExportAccountDataService < ApplicationService
    FORMAT_VERSION = 1

    def initialize(user:)
      @user = user
    end

    # Reads in one REPEATABLE READ transaction so the file is a consistent snapshot.
    # @return [ServiceResult<Hash>] the export as plain JSON values (string keys, ISO 8601 times)
    def call
      export = ActiveRecord::Base.transaction(isolation: :repeatable_read) do
        {
          format_version: FORMAT_VERSION,
          exported_at: Time.current.iso8601,
          account: account,
          career_library: career_library,
          jobs: jobs,
          resumes: resumes,
          chat_conversations: chat_conversations,
          interview_question_sets: interview_question_sets,
          interview_sessions: interview_sessions,
          job_preferences: job_preferences,
          avoided_interview_questions: pick(@user.avoided_interview_questions, :question_text, :created_at)
        }
      end
      success(export.as_json)
    end

    private

    def account
      @user.slice(:email, :name, :contact_email, :phone, :location, :links, :summary,
        :include_summary, :resume_section_order, :created_at, :confirmed_at)
    end

    def career_library
      {
        experiences: @user.experiences.includes(:highlights).map do |experience|
          experience.slice(:company, :title, :location, :start_date, :end_date, :description, :created_at, :updated_at)
            .merge(highlights: experience.highlights.map(&:content))
        end,
        projects: pick(@user.projects, :name, :role, :url, :description, :start_date, :end_date, :ongoing, :created_at, :updated_at),
        educations: pick(@user.educations, :institution, :degree, :field_of_study, :start_date, :end_date, :ongoing,
          :description, :created_at, :updated_at),
        certifications: pick(@user.certifications, :name, :issuer, :issued_date, :expiry_date, :credential_id,
          :credential_url, :description, :created_at, :updated_at),
        skills: pick(@user.skills, :name, :category),
        career_contexts: pick(@user.career_contexts, :requirement, :response, :created_at, :updated_at)
      }
    end

    def jobs
      @user.jobs.includes(:gap_responses, :gap_dismissals).order(:created_at).map do |job|
        job.slice(:title, :company, :location, :url, :description, :responsibilities, :requirements, :nice_to_haves,
          :stage, :applied_at, :notes, :archived_at, :created_at, :updated_at)
          .merge(gap_responses: pick(job.gap_responses, :requirement, :body, :created_at),
            dismissed_gaps: job.gap_dismissals.map(&:requirement))
      end
    end

    def resumes
      @user.resumes.includes(:job, :sections).order(:created_at).map do |resume|
        resume.slice(:title, :include_summary, :created_at, :updated_at)
          .merge(job: resume.job&.slice(:title, :company), sections: pick(resume.sections, :section_type, :title, :content))
      end
    end

    def chat_conversations
      @user.chat_conversations.includes(:messages).order(:created_at).map do |conversation|
        conversation.slice(:title, :created_at)
          .merge(messages: pick(conversation.messages, :role, :content, :created_at))
      end
    end

    def interview_question_sets
      @user.interview_question_sets.includes(:questions).map do |set|
        set.slice(:number, :set_type, :created_at)
          .merge(questions: pick(set.questions, :question_text, :answer_text, :feedback))
      end
    end

    # Expired sessions keep only placeholders, so leave their dialogue out.
    def interview_sessions
      @user.interview_sessions.includes(:questions, :messages, :feedback).map do |interview|
        details = interview.slice(:interview_type, :status, :career_focus, :created_at, :completed_at, :expires_at)
        next details.merge(content_expired: true) if interview.content_purged_at

        details.merge(questions: interview.questions.map(&:content),
          messages: pick(interview.messages, :kind, :content, :created_at),
          feedback: interview.feedback&.content)
      end
    end

    def job_preferences
      @user.job_preference_profile&.slice(:confirmed_criteria, :draft_criteria, :updated_at)
    end

    def pick(records, *fields)
      records.map { |record| record.slice(*fields) }
    end
  end
end
