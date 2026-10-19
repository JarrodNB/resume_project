# Description: Imports a parsed resume (as reviewed and edited by the user) into the career
# library and fills blank profile fields (contact, summary). Experiences, projects, and
# educations and certifications that match an existing entry are merged into it instead of duplicated; the counts
# are stored on the task as result["import_summary"] = { "added", "merged" }. Each parse_resume
# task can be imported once. The library's embeddings are re-synced after the import commits.
# Index:
#   - call: checks the JSON shape, then imports library records and fills the profile in one
#     transaction; returns the accepted AiTask
module ResumeImports
  class ImportParsedResumeService < ApplicationService
    PARTIAL_DATE = /\A(?<year>\d{4})(?:-(?<month>\d{2}))?\z/
    # Parsed contact keys and the User columns they fill.
    CONTACT_COLUMNS = {
      "full_name" => :name, "email" => :contact_email, "phone" => :phone, "location" => :location, "links" => :links
    }.freeze

    # @param parsed_resume [Object] client JSON expected to be a ParsedResume
    #   (see services/ai/schemas/parsed_resume.py); its shape is checked before importing
    def initialize(ai_task:, parsed_resume:)
      @ai_task = ai_task
      @user = ai_task.user
      @raw_parsed_resume = parsed_resume
    end

    # Imports everything under a row lock so a double submit can't import twice.
    def call
      return failure([ "Only completed resume parsing tasks can be imported" ]) unless importable?

      shape = ValidateParsedResumeShapeService.call(parsed_resume: @raw_parsed_resume)
      return shape unless shape.success?

      @parsed_resume = shape.value
      @ai_task.with_lock do
        if @ai_task.accepted?
          failure([ "This resume has already been imported" ])
        else
          import_everything
          @ai_task.update!(accepted_at: Time.current, result: (@ai_task.result || {}).merge("import_summary" => @summary))
          CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
          success(@ai_task)
        end
      end
    rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotSaved => error
      failure(error.record.errors)
    end

    private

    # Returns true for a completed parse_resume task.
    def importable?
      @ai_task.parse_resume? && @ai_task.completed?
    end

    # Fills the profile, then adds or merges the library records.
    def import_everything
      @summary = { "added" => 0, "merged" => 0 }
      fill_blank_profile_fields(@parsed_resume["contact"] || {}, @parsed_resume["summary"])
      add_or_merge_records(@user.experiences, items("experiences")) { |record, item| assign_experience(record, item) }
      add_or_merge_records(@user.projects, items("projects")) { |record, item| assign_project(record, item) }
      add_or_merge_records(@user.educations, items("educations")) { |record, item| assign_education(record, item) }
      add_or_merge_records(@user.certifications, items("certifications")) { |record, item| assign_certification(record, item) }
      create_new_skills
    end

    # Sets name, contact details, and summary only where the user has nothing yet, so a later
    # import never overwrites what they already have.
    def fill_blank_profile_fields(contact, summary)
      values = CONTACT_COLUMNS.to_h { |key, column| [ column, contact[key] ] }.merge(summary: summary)
      blank_fills = values.select { |column, value| @user.public_send(column).blank? && value.present? }
      return if blank_fills.empty?

      @user.assign_attributes(blank_fills)
      RecordScreening::InvalidateService.call(record: @user)
      @user.save!
    end

    # Returns the list under `key`, or an empty list.
    def items(key)
      Array(@parsed_resume[key])
    end

    # Builds one record per item (the block fills it in). A record matching an existing entry,
    # including one saved earlier in this import, is merged into it; otherwise it is saved after
    # the user's existing entries.
    def add_or_merge_records(association, list)
      existing = association.scope.to_a
      next_position = (existing.map(&:position).max || -1) + 1
      list.each do |item|
        record = association.klass.new(user: @user)
        yield(record, item)
        match = CareerLibrary::FindMatchingLibraryRecordService.call(record: record, candidates: existing).value
        if match
          merge_into!(match, record)
        else
          record.update!(position: next_position)
          next_position += 1
          existing << record
          @summary["added"] += 1
        end
      end
    end

    # Merges an unsaved record into its match; raises if the match can't be saved.
    def merge_into!(match, record)
      record.validate!
      result = CareerLibrary::MergeLibraryRecordsService.call(target: match, source: record)
      raise ActiveRecord::RecordInvalid, match unless result.success?

      @summary["merged"] += 1
    end

    # Saves one record per item after the user's existing ones; the block fills in each record.
    def create_records(association, list)
      first_position = (association.maximum(:position) || -1) + 1
      list.each_with_index.map do |item, offset|
        record = association.new(position: first_position + offset)
        yield(record, item)
        record.tap(&:save!)
      end
    end

    # Fills an Experience and its ordered highlights from a parsed experience.
    def assign_experience(experience, item)
      experience.assign_attributes(
        item.slice("company", "title", "location", "description").merge(
          start_date: to_date(item["start_date"]),
          end_date: item["is_current"] ? nil : to_date(item["end_date"])
        )
      )
      Array(item["highlights"]).each_with_index do |content, position|
        experience.highlights.build(content: content, position: position)
      end
    end

    # Fills a Project from a parsed project.
    def assign_project(project, item)
      project.assign_attributes(item.slice("name", "role", "url", "description").merge(dates_of(item)))
    end

    # Fills an Education from a parsed education entry.
    def assign_education(education, item)
      education.assign_attributes(
        item.slice("institution", "degree", "field_of_study", "description").merge(dates_of(item))
      )
    end

    # Fills a Certification from stated credential facts only.
    def assign_certification(certification, item)
      certification.assign_attributes(
        item.slice("name", "issuer", "credential_id", "credential_url", "description").merge(certification_dates(item))
      )
    end

    # Preserves stated precision and exact days for certification dates only.
    def certification_dates(item)
      %w[issued_date expiry_date].each_with_object({}) do |field, attributes|
        value = item[field].to_s
        precision = { 4 => "year", 7 => "month", 10 => "day" }[value.length] || "day"
        attributes[field] = certification_date(value)
        attributes["#{field}_precision"] = precision
      end
    end

    # Parses exact credential days and existing partial dates independently.
    def certification_date(value)
      value.match?(/\A\d{4}-\d{2}-\d{2}\z/) ? Date.iso8601(value) : to_date(value)
    rescue Date::Error
      nil
    end

    # Converts an item's partial start/end dates.
    def dates_of(item)
      { start_date: to_date(item["start_date"]), end_date: to_date(item["end_date"]) }
    end

    # Adds skills the user doesn't have yet (names compare case-insensitively).
    def create_new_skills
      known_names = @user.skills.pluck(:name).map(&:downcase).to_set
      new_skills = items("skills").select { |skill| skill["name"].present? && known_names.add?(skill["name"].downcase) }
      create_records(@user.skills, new_skills) { |record, skill| record.assign_attributes(skill.slice("name", "category")) }
    end

    # Turns "YYYY-MM" or "YYYY" into the first day of that month or year; nil otherwise.
    def to_date(value)
      match = PARTIAL_DATE.match(value.to_s)
      match && Date.new(match[:year].to_i, (match[:month] || 1).to_i, 1)
    rescue Date::Error
      nil
    end
  end
end
