# Description: Imports a parsed resume (as reviewed and edited by the user) into the career
# library and creates a base resume from it. Each parse_resume task can be imported once.
# Index:
#   - call: creates library records + base resume in one transaction; returns the Resume
module ResumeImports
  class ImportParsedResumeService < ApplicationService
    PARTIAL_DATE = /\A(?<year>\d{4})(?:-(?<month>\d{2}))?\z/

    # @param parsed_resume [Hash] a ParsedResume (see services/ai/schemas/parsed_resume.py)
    def initialize(ai_task:, parsed_resume:)
      @ai_task = ai_task
      @user = ai_task.user
      @parsed_resume = parsed_resume.to_h.deep_stringify_keys
    end

    # Imports everything under a row lock so a double submit can't import twice.
    def call
      return failure([ "Only completed resume parsing tasks can be imported" ]) unless importable?

      @ai_task.with_lock do
        if @ai_task.accepted?
          failure([ "This resume has already been imported" ])
        else
          resume = import_everything
          @ai_task.update!(accepted_at: Time.current)
          success(resume)
        end
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # Returns true for a completed parse_resume task.
    def importable?
      @ai_task.parse_resume? && @ai_task.completed?
    end

    # Creates the library records, then the base resume that snapshots them.
    def import_everything
      contact = @parsed_resume["contact"] || {}
      @user.update!(name: contact["full_name"]) if @user.name.blank? && contact["full_name"].present?
      experiences = create_records(@user.experiences, items("experiences")) { |record, item| assign_experience(record, item) }
      projects = create_records(@user.projects, items("projects")) { |record, item| assign_project(record, item) }
      educations = create_records(@user.educations, items("educations")) { |record, item| assign_education(record, item) }
      create_new_skills

      BuildBaseResumeService.call(
        user: @user, contact: contact, summary: @parsed_resume["summary"],
        experiences: experiences, projects: projects, educations: educations, skills: items("skills")
      ).value
    end

    # Returns the list under `key`, or an empty list.
    def items(key)
      Array(@parsed_resume[key])
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
