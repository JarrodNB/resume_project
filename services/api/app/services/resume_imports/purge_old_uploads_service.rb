# Deletes uploaded resume files once their parse finished long enough ago. After parsing, the
# career library and the task's parsed result hold everything the app needs, so the original
# PDF or DOCX (which often carries a home address and phone number) is not kept forever.
module ResumeImports
  class PurgeOldUploadsService < ApplicationService
    RETENTION = 30.days
    BATCH_SIZE = 500

    # Safe to run twice: a file that is already gone is simply skipped.
    # @return [ServiceResult] value is how many uploads this batch purged; a full batch means run again.
    def call
      tasks = AiTask.parse_resume.where(status: %w[completed failed]).where(completed_at: ...RETENTION.ago)
        .joins(:source_file_attachment).includes(source_file_attachment: :blob).limit(BATCH_SIZE).to_a
      tasks.each { |task| task.source_file.purge }
      success(tasks.size)
    end
  end
end
