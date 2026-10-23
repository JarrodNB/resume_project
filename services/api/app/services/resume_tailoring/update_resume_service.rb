# Saves changes to one owned Markdown resume. The caller scopes ownership.
module ResumeTailoring
  class UpdateResumeService < ApplicationService
    def initialize(resume:, markdown:)
      @resume = resume
      @markdown = markdown
    end

    def call
      @resume.update!(markdown: @markdown)
      success(@resume)
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end
