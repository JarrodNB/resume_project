# Description: Replaces the JSON content of sections on a saved resume. Section type, title,
# and order stay as they are. Editing a resume never changes the career library.
# Index:
#   - call: writes the given section content, or returns an error
module ResumeTailoring
  class UpdateResumeSectionsService < ApplicationService
    UNKNOWN_SECTION = "That section isn't on this resume.".freeze

    def initialize(resume:, sections:)
      @resume = resume
      @sections = sections
    end

    # Updates each listed section. Sending the same content again succeeds.
    def call
      updates = parsed_sections
      return failure([ updates ]) if updates.is_a?(String)

      known = @resume.sections.index_by(&:id)
      return failure([ UNKNOWN_SECTION ]) if updates.any? { |update| !known.key?(update[:id]) }

      @resume.with_lock do
        known = @resume.sections.reload.index_by(&:id)
        changed = updates.any? { |update| known[update[:id]].content != update[:content] }
        updates.each { |update| known[update[:id]].update!(content: update[:content]) }
        AtsChecks::ScheduleContentCheckService.call(resume: @resume) if changed
        # Keep these exact saved sections for GraphQL response identity after the lock ends.
        @resume.sections.reload.load
      end
      success(@resume)
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # A list of { id, content }, or an error message. `return` inside `each` leaves this method.
    def parsed_sections
      return "Sections must be a list." unless @sections.is_a?(Array)

      updates = []
      @sections.each do |section|
        return "Each section needs an id." unless section.is_a?(Hash)

        data = section.deep_stringify_keys
        return "Each section needs an id." if data["id"].blank?
        return "Section content must be an object." unless data["content"].is_a?(Hash)

        updates << { id: data["id"], content: data["content"] }
      end
      updates
    end
  end
end
