# Description: Stores an uploaded resume file (PDF or DOCX) and queues a parse_resume AI task.
# The worker downloads the file from storage by its blob key, so only the key goes over SQS.
# Index:
#   - call: validates the file and the user's AI usage limits, uploads, enqueues; returns the AiTask
module ResumeImports
  class StartResumeParsingService < ApplicationService
    ALLOWED_CONTENT_TYPES = %w[
      application/pdf
      application/vnd.openxmlformats-officedocument.wordprocessingml.document
    ].freeze
    MAX_FILE_SIZE = 5.megabytes

    # @param file [#read, #original_filename, #size] the uploaded file
    def initialize(user:, file:)
      @user = user
      @file = file
    end

    # Rejects unsupported or oversized files, then uploads and enqueues.
    def call
      return failure([ "Resume file must be 5 MB or smaller" ]) if @file.size > MAX_FILE_SIZE

      content_type = detect_content_type
      return failure([ "Resume must be a PDF or DOCX file" ]) unless ALLOWED_CONTENT_TYPES.include?(content_type)

      # Checked again under a lock when enqueuing; this early check avoids storing the upload.
      allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @user)
      return allowance unless allowance.success?

      blob = ActiveStorage::Blob.create_and_upload!(
        io: @file, filename: @file.original_filename, content_type: content_type, identify: false
      )
      AiTasks::EnqueueAiTaskService.call(
        user: @user, task_type: "parse_resume", input: task_input(blob), source_file: blob
      )
    end

    private

    # Detects the type from the file's bytes only; the name and declared type are client-controlled.
    def detect_content_type
      Marcel::MimeType.for(@file).tap { @file.rewind }
    end

    # Builds the task input the AI worker reads (see worker/parse_resume_handler.py).
    def task_input(blob)
      { source_file: { key: blob.key, filename: blob.filename.to_s, content_type: blob.content_type } }
    end
  end
end
