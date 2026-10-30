# Owns explicit completed-interview coaching requests, once-only claims and result acceptance.
# Transcript text comes from Rails only after a live claim; queue envelopes contain an identity.
module Interviews
  class SessionFeedback
    # @return [ServiceResult<InterviewSessionFeedback>] existing work or a new bounded attempt
    def request(interview:, retry_failed: false)
      publish = nil
      record = nil
      result = interview.user.with_lock do
        interview.lock!
        next failure("Feedback is available only for retained completed interviews") unless eligible?(interview)
        next failure("No answers were submitted. Complete another interview to get feedback.") if answered_questions(interview).empty?
        record = interview.feedback || interview.build_feedback(expected_revision: interview.revision)
        next success(record) if record.content.present?
        task = record.ai_task
        fail_task(task, "Feedback timed out. Retry explicitly.") if task && !task.finished? && record.deadline <= Time.current
        next success(record) if task && (!task.failed? || !retry_failed)
        next failure("Feedback retry limit reached") if record.attempt_count >= 2
        admission = preparation_admission(interview)
        next admission unless admission.success?
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: interview.user, existing_task: admission.value, interview: true)
        next allowance unless allowance.success?
        record.save! unless record.persisted?
        task = interview.user.ai_tasks.create!(task_type: "interview_session_feedback", subject: interview,
          hourly_admission_task: admission.value, input: { feedback_id: record.id })
        record.update!(ai_task: task, attempt_count: record.attempt_count + 1, claimed_at: nil, deadline: 5.minutes.from_now)
        publish = task
        success(record)
      end
      if publish
        AiTasks::PublishTaskToQueueService.call(ai_task: publish)
      end
      result
    rescue *AiTasks::EnqueueAiTaskService::QUEUE_ERRORS
      with_result_lock(ai_task: publish) { fail_task(publish, "Could not queue feedback. Please retry.") unless publish.finished? } if publish
      saved = interview.user.interview_sessions.find_by(id: interview.id)&.feedback
      saved = nil unless eligible?(saved&.interview_session)
      saved&.content.present? ? success(saved) : failure("Could not queue feedback. Please retry.", value: saved)
    end

    # A duplicate delivery never obtains transcript text or permission for provider work.
    def claim(ai_task:)
      return success(allowed: false) unless ai_task.interview_session_feedback?
      result = with_result_lock(ai_task: ai_task) do |interview, record|
        next success(allowed: false) if ai_task.finished? || !record
        unless available?(interview, record, ai_task)
          fail_task(ai_task, "Interview feedback is no longer available")
          next success(allowed: false)
        end
        next success(allowed: false) if record.claimed_at
        admission = preparation_admission(interview, task: ai_task)
        allowance = admission.success? ? AiUsage::CheckAiTaskAllowanceService.call(user: interview.user, existing_task: ai_task, interview: true) : admission
        unless allowance.success?
          fail_task(ai_task, allowance.errors.join(", "))
          next success(allowed: false)
        end
        record.update!(claimed_at: Time.current)
        questions = answered_questions(interview).map do |question|
          { question_id: question.id, question: question.content,
            dialogue: interview.messages.where(question: question, kind: %w[answer follow_up]).order(:position).map { |message| { kind: message.kind, content: message.content } } }
        end
        success(allowed: true, questions: questions, role: interview.frozen_context["job"] || interview.prepared_role,
          setup: SetupConfiguration.for(interview))
      end
      # A rejected claim produces no final worker result, so publish its saved failure here.
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: ai_task.id }, ai_task) if ai_task.failed?
      result
    end

    # Result accounting and domain acceptance share owner/session/task locks in that order.
    def with_result_lock(ai_task:)
      ai_task.user.with_lock do
        interview = ai_task.user.interview_sessions.find_by(id: ai_task.subject_id)
        interview&.lock!
        record = interview&.feedback
        record = nil unless record&.ai_task_id == ai_task.id
        record&.lock!
        ai_task.with_lock { yield(interview, record) }
      end
    end

    def apply(ai_task:, result:)
      interview = ai_task.user.interview_sessions.find_by(id: ai_task.subject_id)
      record = interview&.feedback
      return failure("Interview feedback is no longer available") unless record&.claimed_at && available?(interview, record, ai_task)
      content = result["interview_session_feedback"] if result.is_a?(Hash)
      return failure("Invalid interview feedback") unless valid_content?(content, interview)
      record.update!(content: content)
      success(record)
    end

    # Removes retained coaching and every attempt's payload before expiry or deletion.
    # Usage receipts and terminal outcomes survive; unfinished work becomes a safe failure.
    def purge(interview:, reason: :expired)
      interview.user.with_lock do
        interview.lock!
        interview.feedback&.update!(content: {})
        interview.user.ai_tasks.where(subject: interview, task_type: "interview_session_feedback").order(:id).each do |task|
          task.with_lock do
            AiTasks::UpdateTaskService.call(task: task, attributes: { input: {}, result: nil,
              status: task.finished? ? task.status : "failed", error_message: reason == :deleted ? "interview_deleted" : "interview_expired",
              completed_at: task.completed_at || Time.current })
          end
        end
      end
      success(nil)
    end

    private

    def eligible?(interview)
      interview&.completed? && interview.expires_at > Time.current && !interview.content_purged_at
    end

    def answered_questions(interview)
      interview.questions.where(id: interview.messages.answer.select(:question_id)).order(:position)
    end

    def available?(interview, record, task)
      eligible?(interview) && record.ai_task_id == task.id && record.deadline > Time.current &&
        record.expected_revision == interview.revision && task.input["feedback_id"] == record.id && record.content.empty?
    end

    def preparation_admission(interview, task: nil)
      preparation = interview.operations.preparation.first
      root = preparation&.ai_task
      if preparation || interview.frozen_context.present? || task&.hourly_admission_task_id
        valid = root && root.user_id == interview.user_id && root.subject == interview && root.interview_preparation? &&
          root.hourly_admission_task_id.nil? && root.input["operation_id"] == preparation.id
        valid &&= task.hourly_admission_task_id == root.id if task
        return failure("Interview admission is invalid") unless valid
      end
      success(root)
    end

    def valid_content?(content, interview)
      return false unless content.is_a?(Hash) && content.keys.sort == %w[questions summary] && text?(content["summary"], 4000)
      return false if JSON.generate(content).bytesize > 120_000
      entries = content["questions"]
      ids = answered_questions(interview).pluck(:id)
      return false unless entries.is_a?(Array) && entries.size == ids.size && entries.size.between?(1, 20)
      return false unless entries.all? { |entry| entry.is_a?(Hash) && entry.keys.sort == %w[example_answer improvements question_id strengths] &&
        entry["question_id"].is_a?(String) && text?(entry["example_answer"], 6000) && %w[strengths improvements].all? { |key| entry[key].is_a?(Array) && entry[key].size.between?(1, 5) && entry[key].all? { |text| text?(text, 2000) } } }
      entries.map { |entry| entry["question_id"] }.sort == ids.sort
    end

    def text?(text, limit) = text.is_a?(String) && text.strip.present? && text.length <= limit

    def fail_task(task, message)
      AiTasks::UpdateTaskService.call(task: task, attributes: { status: "failed", error_message: message, completed_at: Time.current })
    end

    def success(value) = ServiceResult.new(success: true, value: value, errors: [])
    def failure(errors, value: nil) = ServiceResult.new(success: false, value: value, errors: Array(errors))
  end
end
