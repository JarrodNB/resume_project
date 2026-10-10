# Description: Builds the text embedded for each of a user's career library entries. Each text
# carries enough context to stand on its own in a similarity search: a highlight names its role
# ("Senior Engineer at Acme: Cut deploy time 40%"), a skill its category ("Languages: Ruby").
# Index:
#   - call: returns [{ source_type:, source_id:, content: }] for every experience, highlight,
#     project, education, certification, skill, and library fact of the user. Job-only gap responses are not
#     embedded.
module CareerLibrary
  class BuildEmbeddingTextsService < ApplicationService
    def initialize(user:)
      @user = user
    end

    # Lists one embedding text per library entry. Queries the database directly (not the user's
    # possibly loaded associations), so a sync always sees the latest library.
    def call
      experiences = Experience.where(user_id: @user.id).includes(:highlights)
      entries = experiences.flat_map { |experience| experience_entries(experience) }
      entries += Project.where(user_id: @user.id).map { |project| entry(project, project_text(project)) }
      entries += Education.where(user_id: @user.id).map { |education| entry(education, education_text(education)) }
      entries += Certification.where(user_id: @user.id).map { |certification| entry(certification, certification_text(certification)) }
      entries += Skill.where(user_id: @user.id).map { |skill| entry(skill, skill_text(skill)) }
      entries += LibraryFact.where(user_id: @user.id).order(:created_at).map { |fact| entry(fact, fact_text(fact)) }
      success(entries)
    end

    private

    # The experience itself plus one entry per highlight, each prefixed with the role.
    def experience_entries(experience)
      role = "#{experience.title} at #{experience.company}"
      heading = [ role, parenthesized(experience.location) ].compact.join(" ")
      [ entry(experience, with_details(heading, experience.description)) ] +
        experience.highlights.map { |highlight| entry(highlight, "#{role}: #{highlight.content}") }
    end

    # "Project: Name (role): description".
    def project_text(project)
      with_details([ "Project: #{project.name}", parenthesized(project.role) ].compact.join(" "), project.description)
    end

    # "Degree in Field, Institution: description" (missing parts left out).
    def education_text(education)
      degree = [ education.degree, education.field_of_study ].compact_blank.join(" in ")
      with_details([ degree.presence, education.institution ].compact.join(", "), education.description)
    end

    # Includes credential facts and dates so evidence never implies an unstated validity period.
    def certification_text(certification)
      fields = %w[issuer issued_date expiry_date credential_id credential_url].filter_map do |field|
        "#{field.humanize(keep_id_suffix: true)}: #{certification_value(certification, field)}" if certification[field].present?
      end
      with_details(([ "Certification: #{certification.name}" ] + fields).join(", "), certification.description)
    end

    # Formats a credential date using only the precision stated by the user.
    def certification_value(certification, field)
      value = certification[field]
      return value unless %w[issued_date expiry_date].include?(field)

      value.strftime({ "year" => "%Y", "month" => "%Y-%m", "day" => "%Y-%m-%d" }.fetch(certification["#{field}_precision"]))
    end

    # "Fact: requirement: response", so a search can match either side.
    def fact_text(fact)
      "Fact: #{fact.requirement}: #{fact.response}"
    end

    # "Category: Name", or just the name.
    def skill_text(skill)
      [ skill.category.presence, skill.name ].compact.join(": ")
    end

    # Appends ": details" when details are present.
    def with_details(heading, details)
      details.present? ? "#{heading}: #{details.squish}" : heading
    end

    # "(text)", or nil when blank.
    def parenthesized(text)
      "(#{text})" if text.present?
    end

    # One entry hash for a record.
    def entry(record, content)
      { source_type: record.class.name, source_id: record.id, content: content }
    end
  end
end
