# Description: Creates the Resume and ResumeSection snapshots from a finished tailoring draft,
# once. Deleting the job later keeps the resume (the job is optional after create).
# Index:
#   - call: saves the resume and stamps accepted_at under a row lock
module ResumeTailoring
  class SaveTailoredResumeService < ApplicationService
    NOT_READY_MESSAGE = "Finish the resume before saving it.".freeze
    ALREADY_SAVED_MESSAGE = "This resume has already been saved.".freeze

    def initialize(ai_task:, sections: nil)
      @ai_task = ai_task
      @sections = sections
    end

    # Saves once. A second call returns an error without creating another resume.
    def call
      return failure([ NOT_READY_MESSAGE ]) unless @ai_task.tailor_resume? && @ai_task.completed?

      return failure([ "This job no longer exists." ]) unless @ai_task.subject.is_a?(Job)

      @ai_task.with_lock do
        return failure([ ALREADY_SAVED_MESSAGE ]) if @ai_task.accepted?

        sections = normalized_sections
        return failure([ NOT_READY_MESSAGE ]) if sections.empty?

        resume = create_resume(sections)
        @ai_task.update!(accepted_at: Time.current)
        success(resume)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # The client's final edits when it sent them, otherwise the draft on the task.
    def normalized_sections
      raw = @sections.nil? ? @ai_task.result&.dig("sections") : @sections
      return [] unless raw.is_a?(Array)

      raw.select { |section| section.is_a?(Hash) && saveable?(section) }
    end

    # True when the section type is one the resume model stores.
    def saveable?(section)
      ResumeSection::SECTION_TYPES.include?(section["section_type"]) && section["content"].is_a?(Hash)
    end

    # One resume and its sections, in the order given.
    def create_resume(sections)
      job = @ai_task.subject
      title = job ? "#{job.title} at #{job.company.presence || 'Unknown company'}" : "Tailored resume"
      Resume.transaction do
        resume = @ai_task.user.resumes.create!(job: job, title: title)
        sections.each_with_index do |section, index|
          resume.sections.create!(
            section_type: section["section_type"],
            title: section["title"].presence || section["section_type"].to_s.titleize,
            position: index,
            content: section["content"]
          )
        end
        resume
      end
    end
  end
end
