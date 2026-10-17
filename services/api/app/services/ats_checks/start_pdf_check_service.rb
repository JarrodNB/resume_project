# Bind an export upload to the owned saved snapshot, without disturbing content checks.
module AtsChecks
  class StartPdfCheckService < ApplicationService
    RENDERER_VERSION = "resume-pdf-v1".freeze
    MAX_FILE_SIZE = 5.megabytes

    def initialize(resume:, run_id:, content_fingerprint:, renderer_version:, file:)
      @resume, @run_id, @fingerprint, @renderer, @file = resume, run_id, content_fingerprint, renderer_version, file
    end

    # Returns the matching report. Only trusted immutable snapshots supply expected text.
    def call
      return failure([ "PDF must be 5 MB or smaller." ]) if @file.size > MAX_FILE_SIZE
      type = Marcel::MimeType.for(@file).tap { @file.rewind }
      return failure([ "Export must contain PDF bytes." ]) unless type == "application/pdf"
      return failure([ "Please refresh before exporting with this PDF renderer." ]) unless @renderer == RENDERER_VERSION
      bytes = @file.read(MAX_FILE_SIZE + 1)
      return failure([ "PDF must be 5 MB or smaller." ]) if bytes.bytesize > MAX_FILE_SIZE
      @file.rewind
      digest = Digest::SHA256.hexdigest(bytes)
      @resume.user.with_lock do
        @resume.with_lock do
          @run = @resume.ats_check_runs.order(created_at: :desc, id: :desc).first
          unless @run && @run.id == @run_id && @run.content_fingerprint == @fingerprint &&
              Snapshot.fingerprint(Snapshot.content(@resume)) == @fingerprint && @run.rubric_version == Snapshot::RUBRIC_VERSION
            return failure([ "Resume changed. Refresh and export the saved version again." ])
          end
          @run.with_lock do
            previous = @run.pdf_result
            if previous["digest"] == digest && previous["renderer_version"] == @renderer && previous["status"] == "queued"
              return ReadReportService.call(resume: @resume, run: @run)
            end
            allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @resume.user)
            return allowance unless allowance.success?
            @blob = ActiveStorage::Blob.create_and_upload!(io: StringIO.new(bytes), filename: "resume.pdf", content_type: type, identify: false)
            identity = { "run_id" => @run.id, "resume_id" => @resume.id, "content_fingerprint" => @fingerprint,
                         "rubric_version" => @run.rubric_version, "renderer_version" => @renderer, "digest" => digest }
            @task = @resume.user.ai_tasks.create!(task_type: "check_resume_pdf", subject: @resume,
              input: identity.merge("source_file" => { "key" => @blob.key, "content_type" => type }))
            @task.source_file.attach(@blob)
            @run.update!(pdf_result: identity.merge("task_id" => @task.id, "status" => "queued"))
          end
        end
      end
      message = { ai_task_id: @task.id, user_id: @task.user_id, task_type: @task.task_type, input: @task.input }
      Shoryuken::Client.queues(AI_TASKS_QUEUE_NAME).send_message(message_body: message.to_json)
      begin
        CleanupPdfCheckJob.set(wait: 24.hours).perform_later(@task.id)
      rescue StandardError => error
        # The recovery sweep also finds abandoned tasks if delayed scheduling is unavailable.
        Rails.logger.error("ATS PDF cleanup scheduling failed: #{error.class}")
      end
      ReadReportService.call(resume: @resume, run: @run)
    rescue StandardError => error
      Rails.logger.error("ATS PDF start failed: #{error.class}")
      if @task&.persisted?
        AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => @task.id, "status" => "failed", "error_message" => "Could not queue PDF inspection. Export again to retry." })
      end
      @blob&.purge
      failure([ "Could not start PDF inspection. Export again to retry." ])
    ensure
      NotifyReportService.call(resume: @resume) if @run
    end
  end
end
