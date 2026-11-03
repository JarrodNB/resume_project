# Replaces saved section content and optionally the section order and the independent summary
# inclusion choice. Hidden summary text stays stored. Section type and title stay as they are,
# and contact always stays first. Editing a resume never changes the career library.
# Index:
#   - call: writes section content, order and summary inclusion atomically, or returns an error
module ResumeTailoring
  class UpdateResumeSectionsService < ApplicationService
    UNKNOWN_SECTION = "That section isn't on this resume.".freeze
    CONTACT_NOT_FIRST = "Contact must stay at the top of the resume.".freeze

    def initialize(resume:, sections:, include_summary: nil, section_order: nil)
      @resume = resume
      @sections = sections
      @include_summary = include_summary
      @section_order = section_order
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
        # Runs before any other write, so a rejected order leaves the whole resume unchanged.
        if @section_order
          return failure([ CONTACT_NOT_FIRST ]) unless contact_first?(known.values)

          reordered = CareerLibrary::ReorderLibraryEntriesService.call(records: @resume.sections, ordered_ids: @section_order)
          return failure(reordered.errors) unless reordered.success?
        end
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

    # True when the new order starts with the contact section, or the resume has none.
    def contact_first?(sections)
      contact = sections.find(&:contact?)
      contact.nil? || @section_order.first.to_s == contact.id
    end

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
