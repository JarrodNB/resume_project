# Description: Creates a base resume whose sections snapshot the given career library records
# (section content shapes are documented in ResumeSection). Empty sections are skipped.
# Index:
#   - call: creates the resume and its ordered sections; returns the Resume
module ResumeImports
  class BuildBaseResumeService < ApplicationService
    TITLE = "Base resume".freeze

    # @param contact [Hash] parsed contact info
    # @param skills [Array<Hash>] parsed skills ({ "name", "category" })
    def initialize(user:, contact:, summary:, experiences:, projects:, educations:, skills:)
      @user = user
      @contact = contact
      @summary = summary
      @experiences = experiences
      @projects = projects
      @educations = educations
      @skills = skills
    end

    # Creates the resume and sections. Raises ActiveRecord::RecordInvalid if anything is invalid.
    def call
      resume = @user.resumes.create!(title: TITLE, kind: "base")
      section_definitions.each_with_index do |(section_type, title, content), position|
        resume.sections.create!(section_type:, title:, content:, position:)
      end
      success(resume)
    end

    private

    # Lists [section_type, title, content] for every non-empty section, in resume order.
    def section_definitions
      [
        [ "contact", "Contact", @contact.slice("full_name", "email", "phone", "location", "links") ],
        [ "summary", "Summary", @summary.present? ? { "text" => @summary } : nil ],
        [ "experience", "Experience", list_content(@experiences.map { |record| experience_snapshot(record) }) ],
        [ "projects", "Projects", list_content(@projects.map { |record| snapshot(record, %w[name role url description]) }) ],
        [ "education", "Education", list_content(@educations.map { |record| snapshot(record, %w[institution degree field_of_study description]) }) ],
        [ "skills", "Skills", list_content(@skills.map { |skill| skill.slice("name", "category") }) ]
      ].select { |_type, _title, content| content.present? }
    end

    # Wraps a list as section content, or nil when it's empty.
    def list_content(items)
      items.any? ? { "items" => items } : nil
    end

    # Copies the given attributes (plus id and dates) from a library record.
    def snapshot(record, attribute_names)
      record.as_json(only: [ "id", "start_date", "end_date", *attribute_names ])
    end

    # Copies an experience with its highlights inline.
    def experience_snapshot(experience)
      snapshot(experience, %w[company title location description])
        .merge("highlights" => experience.highlights.map(&:content))
    end
  end
end
