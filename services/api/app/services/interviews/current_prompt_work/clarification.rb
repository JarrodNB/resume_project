# Clarification is question-only help: successful wording must be nonblank and bounded.
# Its duplicate-claim guard intentionally precedes expiry checks, preserving the existing
# recovery contract in which a fresh request finalizes an expired claimed attempt.
module Interviews
  class CurrentPromptWork
    class Clarification < CurrentPromptWork
      private

      def records(interview) = interview.clarifications
      def task_type = "interview_clarification"
      def label = "Clarification"
      def claimed_guard_first? = true
      def reusable?(record) = record.explanation.present?

      def check_allowance(user:, existing_task:)
        AiUsage::CheckAiTaskAllowanceService.call(user: user, existing_task: existing_task, interview: true)
      end

      def task_input(interview, record)
        { clarification_id: record.id, message_id: record.message_id, question_digest: Digest::SHA256.hexdigest(record.message.content) }
      end

      def valid_claim_input?(interview, record, task) = true

      def claim_payload(interview, record)
        { allowed: true, interview_id: interview.id, record_id: record.id, claimed_at: record.claimed_at.iso8601(6) }
      end

      def result_attributes(task, result)
        explanation = result["explanation"] if result.is_a?(Hash)
        return failure("Invalid question clarification") unless explanation.is_a?(String) && explanation.present? && explanation.length <= 1000
        success({ explanation: explanation })
      end
    end
  end
end
