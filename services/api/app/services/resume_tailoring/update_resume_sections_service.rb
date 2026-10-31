# Replaces saved section content and optionally the independent summary inclusion choice.
# Hidden summary text stays stored. Section type, title,
# and order stay as they are. Editing a resume never changes the career library.
# Index:
#   - call: writes section content and summary inclusion atomically, or returns an error
module ResumeTailoring
  class UpdateResumeSectionsService < ApplicationService
    UNKNOWN_SECTION = "That section isn't on this resume.".freeze

    def initialize(resume:, sections:, include_summary: nil)
      @resume = resume
      @sections = sections
      @include_summary = include_summary
    end

    # Updates each listed section. Sending the same content again succeeds.
    def call
      updates = parsed_sections
      return failure([ updates ]) if updates.is_a?(String)

      return failure([ "Include summary must be true or false." ]) unless @include_summary.nil? || [ true, false ].include?(@include_summary)

      @resume.user.with_lock do
        @resume.lock!
        known = @resume.sections.index_by(&:id)
        return failure([ UNKNOWN_SECTION ]) if updates.any? { |update| !known.key?(update[:id]) }
        @resume.update!(include_summary: @include_summary) unless @include_summary.nil?
        updates.each { |update| known[update[:id]].update!(content: update[:content]) }
      end
      success(@resume.reload)
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # A list of { id, content }, or an error message. `return` inside `map` leaves this method.
    def parsed_sections
      return "Sections must be a list." unless @sections.is_a?(Array)

      @sections.map do |section|
        return "Each section needs an id." unless section.is_a?(Hash)

        data = section.deep_stringify_keys
        return "Each section needs an id." if data["id"].blank?
        return "Section content must be an object." unless data["content"].is_a?(Hash)

        { id: data["id"], content: data["content"] }
      end
    end
  end
end
