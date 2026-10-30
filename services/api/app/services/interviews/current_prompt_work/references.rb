# Career references search saved evidence with their own in-flight allowance.
# An empty successful search is reusable. Acceptance verifies exact owned source wording,
# while claim validation fences changes to the canonical follow-up search context.
module Interviews
  class CurrentPromptWork
    class References < CurrentPromptWork
      SOURCES = { "Experience" => :experiences, "Project" => :projects, "Education" => :educations,
        "Certification" => :certifications, "Skill" => :skills, "CareerContext" => :career_contexts }.freeze

      private

      def records(interview) = interview.career_references
      def task_type = "interview_references"
      def label = "References"
      def claimed_guard_first? = false
      def reusable?(record) = record.references.any? || record.ai_task&.completed?

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
