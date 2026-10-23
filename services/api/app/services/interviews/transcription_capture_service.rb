# Admit exactly one live provider connection and durably finish its text and usage.
# Network work is performed by the AI process after these owner-first locks release.
require "digest"

module Interviews
  class TranscriptionCaptureService < ApplicationService
    MODEL = "gpt-live-transcribe"

    def initialize(action:, token: nil, capture_id: nil, transcript: nil, usage: nil)
      @action, @token, @capture_id, @transcript, @usage = action, token, capture_id, transcript, usage
    end

    # @return [ServiceResult<Hash>] persisted capture state, or a bounded rejection
    def call
      return failure("Invalid capture action") unless %w[redeem finish fail].include?(@action)
      capture = if @action == "redeem"
        return failure("Invalid capability") unless @token.is_a?(String) && @token.length.between?(40, 100)
        InterviewTranscriptionCapture.find_by(token_digest: Digest::SHA256.hexdigest(@token))
      else
        InterviewTranscriptionCapture.find_by(id: @capture_id)
      end
      return failure("Capture unavailable") unless capture
      interview = capture.interview_session
      interview.user.with_lock do
        interview.lock!
        capture.lock!
        capture.ai_task&.lock!
        if @action == "redeem"
          next failure("Capture unavailable") unless capture.status == "authorized" && current?(capture, interview)
          other = InterviewTranscriptionCapture.joins(:interview_session)
            .where(interview_sessions: { user_id: interview.user_id }, status: "streaming")
            .where("interview_transcription_captures.expires_at > ?", Time.current)
          next failure("Another transcription is already active") if other.exists?
          root = interview.operations.preparation.first&.ai_task
          allowance = AiUsage::CheckAiTaskAllowanceService.call(user: interview.user, existing_task: root, interview: true)
          next allowance unless allowance.success?
          task = interview.user.ai_tasks.create!(task_type: "interview_transcription", subject: interview,
            hourly_admission_task: root, input: { capture_id: capture.id })
          unless VerificationBudget.reserve(observation_id: capture.observation_id, stage: "transcription", provider: "openai", model: MODEL)
            task.update!(status: "failed", completed_at: Time.current, error_message: "capture_admission_failed")
            next failure("Transcription allowance unavailable")
          end
          AiTasks::RecordAttemptUsageService.call(ai_task: task,
            message: { "attempt_id" => capture.observation_id, "attempt_finished" => false })
          capture.update!(ai_task: task, status: "streaming")
          next success({ capture_id: capture.id, expires_at: capture.expires_at.iso8601, observation_id: capture.observation_id })
        end
        next failure("Capture was not admitted") unless capture.ai_task
        usage = record_usage(capture)
        next usage unless usage.success?
        if capture.status == "completed"
          next @action == "finish" && capture.transcript == @transcript ? success({ capture_id: capture.id }) : failure("Capture completion conflicts")
        end
        next success({ capture_id: capture.id }) if @action == "fail" && capture.status == "failed"
        next failure("Capture unavailable") unless capture.status == "streaming"
        usable = @action == "finish" && current?(capture, interview) && @transcript.is_a?(String) && @transcript.strip.present? && @transcript.length <= 4000
        capture.update!(status: usable ? "completed" : "failed", transcript: usable ? @transcript : nil)
        capture.ai_task.update!(status: usable ? "completed" : "failed", completed_at: Time.current,
          error_message: usable ? nil : "transcription_unavailable")
        usable || @action == "fail" ? success({ capture_id: capture.id }) : failure("Capture transcript unavailable")
      end
    end

    private

    def current?(capture, interview)
      capture.expires_at > Time.current && interview.active? && interview.expires_at > Time.current &&
        interview.revision == capture.expected_revision && interview.current_question_position == capture.question.position &&
        !interview.operations.turn.where(status: %w[pending running]).exists?
    end

    def record_usage(capture)
      return failure("Invalid usage") unless @usage.nil? || (@usage.is_a?(Hash) && @usage.keys.sort == %w[audio_milliseconds cost_microdollars] &&
        @usage["audio_milliseconds"].is_a?(Integer) && @usage["audio_milliseconds"].between?(1, 120_000) &&
        @usage["cost_microdollars"].is_a?(Integer) && @usage["cost_microdollars"].between?(1, 34_000))
      report = capture.ai_task.ai_usage_attempts.find_by!(attempt_id: capture.observation_id)
      entries = @usage ? [ @usage.merge("stage" => "transcription", "provider" => "openai", "model" => MODEL) ] : []
      if report.finalized? && !report.incomplete?
        return @usage.nil? || report.usage == entries ? success : failure("Capture usage conflicts")
      end
      if @usage
        report.update!(finalized: false) if report.finalized?
        VerificationBudget.reconcile(observation_id: capture.observation_id, cost: @usage.fetch("cost_microdollars"))
      end
      AiTasks::RecordAttemptUsageService.call(ai_task: capture.ai_task, message: {
        "attempt_id" => capture.observation_id, "usage" => entries, "usage_incomplete" => @usage.nil? })
      success
    end
  end
end
