# Career references search saved evidence with their own in-flight allowance.
# Each interview visit can refresh successful work; duplicate visits reuse its search.
# Acceptance verifies exact owned source wording,
# while claim validation fences changes to the canonical follow-up search context.
module Interviews
  class CurrentPromptWork
    class References < CurrentPromptWork
      SOURCES = { "Experience" => :experiences, "Project" => :projects, "Education" => :educations,
        "Certification" => :certifications, "Skill" => :skills, "CareerContext" => :career_contexts }.freeze

      # A visit receipt makes retrying the navigation request safe even after later visits.
      # Failed work still requires an explicit retry; only completed work starts a new cycle.
      def request(interview:, message_id:, retry_failed: false, visit_id: nil)
        return failure("Invalid interview visit") if visit_id && !visit_id.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i)
        publish = nil
        result = interview.user.with_lock do
          interview.lock!
          message = interview.messages.find_by(id: message_id, kind: %w[opening follow_up])
          next failure("Question is no longer current") unless ClarificationPrompt.current?(interview, message)
          record = records(interview).find_or_initialize_by(message: message)
          seen_visit = visit_id && record.persisted? && record.visits.exists?(visit_id: visit_id)
          task = record.ai_task
          refresh = visit_id && !seen_visit && task&.completed?
          if task && !task.finished? && record.deadline && record.deadline <= Time.current
            fail_task(task, "References timed out. Retry explicitly.")
          end
          if !refresh && (task&.completed? || (task && (!task.failed? || !retry_failed)))
            record.visits.find_or_create_by!(visit_id: visit_id) if visit_id
            next success(record)
          end
          next failure("References retry limit reached") if !refresh && record.retry_count >= 1
          admission = preparation_admission(interview)
          next admission unless admission.success?
          allowance = check_allowance(user: interview.user, existing_task: admission.value)
          next allowance unless allowance.success?
          record.save! unless record.persisted?
          task = interview.user.ai_tasks.create!(task_type: task_type, subject: interview,
            hourly_admission_task: admission.value, input: task_input(interview, record))
          record.update!(ai_task: task, attempt_count: record.attempt_count + 1,
            retry_count: refresh || record.attempt_count.zero? ? 0 : record.retry_count + 1,
            references: [], claimed_at: nil, deadline: 3.minutes.from_now)
          record.visits.find_or_create_by!(visit_id: visit_id) if visit_id
          publish = task
          success(record)
        end
        AiTasks::PublishTaskToQueueService.call(ai_task: publish) if publish
        result
      rescue *AiTasks::EnqueueAiTaskService::QUEUE_ERRORS
        if publish
          with_result_lock(ai_task: publish) do
            fail_task(publish, "Could not queue references") unless publish.finished?
          end
        end
        failure("Could not queue references. Please retry.")
      end

      private

      def records(interview) = interview.career_references
      def task_type = "interview_references"
      def label = "References"
      def claimed_guard_first? = false

      def check_allowance(user:, existing_task:)
        AiUsage::CheckAiTaskAllowanceService.call(user: user, existing_task: existing_task, interview: true, reference_work: true)
      end

      def task_input(interview, record)
        { reference_id: record.id, message_id: record.message_id, question_digest: Digest::SHA256.hexdigest(record.message.content),
          query_digest: Digest::SHA256.hexdigest(ReferenceQuery.for(interview, record.message)) }
      end

      def valid_claim_input?(interview, record, task)
        !task.input.key?("query_digest") || task.input["query_digest"] == Digest::SHA256.hexdigest(ReferenceQuery.for(interview, record.message))
      end

      def claim_payload(interview, record)
        { allowed: true, interview_id: interview.id, record_id: record.id, claimed_at: record.claimed_at.iso8601(6) }
      end

      def result_attributes(task, result)
        entries = result["references"] if result.is_a?(Hash)
        return failure("Invalid career references") unless entries.is_a?(Array) && entries.size <= 3 && entries.all? { |entry| valid_entry?(task, entry) }
        return failure("Repeated career references") unless entries.map { |entry| [ entry["source_type"], entry["source_id"] ] }.uniq.size == entries.size
        success({ references: entries })
      end

      def valid_entry?(task, entry)
        return false unless entry.is_a?(Hash) && entry.keys.sort == %w[body source_id source_type title] &&
          entry["source_id"].is_a?(String) && entry["title"].is_a?(String) && entry["title"].length.between?(1, 280) &&
          entry["body"].is_a?(String) && entry["body"].length.between?(1, 4000)
        source = if entry["source_type"] == "ExperienceHighlight"
          ExperienceHighlight.joins(:experience).where(experiences: { user_id: task.user_id }).find_by(id: entry["source_id"])
        elsif (association = SOURCES[entry["source_type"]])
          task.user.public_send(association).find_by(id: entry["source_id"])
        end
        return false unless source
        # Acceptance checks provenance once; saved references do not monitor future edits.
        fields = entry["source_type"] == "CareerContext" ? %w[response] : %w[content description name degree field_of_study]
        fields.any? { |field| source.has_attribute?(field) && source[field] == entry["body"] }
      end
    end
  end
end
