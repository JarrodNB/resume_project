# Career references search saved evidence with their own in-flight allowance.
# An empty successful search is reusable. Acceptance verifies exact owned source wording,
# while claim validation fences changes to the frozen follow-up search context.
module Interviews
  class CurrentPromptWork
    class References < CurrentPromptWork
      SOURCES = { "Experience" => :experiences, "Project" => :projects, "Education" => :educations,
        "Certification" => :certifications, "Skill" => :skills, "LibraryFact" => :library_facts }.freeze

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
        query_input = record.message.follow_up? ? { query_text: ReferenceQuery.for(interview, record.message) } : {}
        { reference_id: record.id, question_text: record.message.content }.merge(query_input)
      end

      def valid_claim_input?(interview, record, task)
        (task.input["query_text"] || task.input["question_text"]) == ReferenceQuery.for(interview, record.message)
      end

      def claim_payload(interview, record)
        { allowed: true, question_text: record.message.content,
          query_text: ReferenceQuery.for(interview, record.message), user_id: interview.user_id, reference_id: record.id }
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
        fields = entry["source_type"] == "LibraryFact" ? %w[response] : %w[content description name degree field_of_study]
        fields.any? { |field| source.has_attribute?(field) && source[field] == entry["body"] }
      end
    end
  end
end
