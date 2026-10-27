# Accepts bounded, owned career evidence only for the still-current claimed prompt.
# The result caller holds owner, interview, reference and task locks in that order.
module Interviews
  class ApplyReferencesService < ApplicationService
    SOURCES = { "Experience" => :experiences, "Project" => :projects, "Education" => :educations,
      "Certification" => :certifications, "Skill" => :skills, "LibraryFact" => :library_facts }.freeze

    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      interview = @task.user.interview_sessions.find_by(id: @task.subject_id)
      record = interview&.career_references&.find_by(ai_task_id: @task.id)
      return failure("Question is no longer available") unless record && record.claimed_at && record.deadline > Time.current &&
        ClarificationPrompt.current?(interview, record.message) && @task.input["question_text"] == record.message.content
      entries = @result["references"] if @result.is_a?(Hash)
      return failure("Invalid career references") unless entries.is_a?(Array) && entries.size <= 3 && entries.all? { |entry| valid_entry?(entry) }
      return failure("Repeated career references") unless entries.map { |e| [e["source_type"], e["source_id"]] }.uniq.size == entries.size
      record.update!(references: entries)
      success(record)
    end

    private

    def valid_entry?(entry)
      return false unless entry.is_a?(Hash) && entry.keys.sort == %w[body source_id source_type title] &&
        entry["source_id"].is_a?(String) && entry["title"].is_a?(String) && entry["title"].length.between?(1, 280) &&
        entry["body"].is_a?(String) && entry["body"].length.between?(1, 4000)
      source = if entry["source_type"] == "ExperienceHighlight"
        ExperienceHighlight.joins(:experience).where(experiences: { user_id: @task.user_id }).find_by(id: entry["source_id"])
      elsif (association = SOURCES[entry["source_type"]])
        @task.user.public_send(association).find_by(id: entry["source_id"])
      end
      return false unless source
      # This is an ownership/provenance check at acceptance, not ongoing library monitoring.
      fields = entry["source_type"] == "LibraryFact" ? %w[response] : %w[content description name degree field_of_study]
      fields.any? { |field| source.has_attribute?(field) && source[field] == entry["body"] }
    end
  end
end
