# Checks reviewed resume JSON before import so malformed nested entries return errors.
# Grouped employment has bounded ordered roles and separate shared/role bullet lists;
# legacy flat payloads remain readable without rewriting stored task results.
module ResumeImports
  class ValidateParsedResumeShapeService < ApplicationService
    LIST_KEYS = %w[experiences projects educations certifications skills].freeze

    # @param parsed_resume [Object] the raw JSON argument (any type)
    def initialize(parsed_resume:)
      @parsed_resume = parsed_resume
    end

    # Validates the structure and returns the parsed resume with string keys.
    def call
      return failure([ "Parsed resume must be an object" ]) unless @parsed_resume.is_a?(Hash)

      parsed_resume = @parsed_resume.deep_stringify_keys
      errors = shape_errors(parsed_resume)
      errors.empty? ? success(parsed_resume) : failure(errors)
    end

    private

    # Lists every structural problem in the parsed resume.
    def shape_errors(parsed_resume)
      errors = []
      errors << "contact must be an object" unless optional?(parsed_resume["contact"], Hash)
      errors << "summary must be a string" unless optional?(parsed_resume["summary"], String)
      LIST_KEYS.each do |key|
        errors << "#{key} must be a list of objects" unless list_of?(parsed_resume[key], Hash)
      end
      errors.concat(item_errors(parsed_resume)) if errors.empty?
      errors
    end

    # Checks the nested fields the import calls methods on.
    def item_errors(parsed_resume)
      errors = []
      contact = parsed_resume["contact"] || {}
      valid_links = list_of?(contact["links"], Hash) && Array(contact["links"]).all? do |link|
        link["label"].is_a?(String) && link["url"].is_a?(String)
      end
      errors << "contact links must be a list of objects with string labels and URLs" unless valid_links
      Array(parsed_resume["experiences"]).each { |item| errors.concat(experience_errors(item)) }
      unless Array(parsed_resume["skills"]).all? { |item| optional?(item["name"], String) }
        errors << "skill names must be strings"
      end
      errors
    end

    # Rejects ambiguous mixed contracts instead of silently dropping flat role fields.
    def experience_errors(item)
      errors = []
      fields = %w[company location description]
      errors << "experience fields must be strings" unless fields.all? { |key| optional?(item[key], String) }
      if item.key?("roles")
        legacy_fields = %w[title start_date end_date is_current highlights]
        errors << "grouped experiences cannot include flat role fields" if legacy_fields.any? { |key| item.key?(key) }
        roles = item["roles"]
        unless roles.is_a?(Array) && roles.all?(Hash) && roles.size.between?(1, TextLimits::MAX_ROLES_PER_EXPERIENCE)
          return errors + [ "experience roles must contain 1 to #{TextLimits::MAX_ROLES_PER_EXPERIENCE} role objects" ]
        end
        roles.each { |role| errors.concat(role_errors(role)) }
      else
        errors.concat(role_errors(item))
      end
      errors.concat(bullet_errors(item["shared_highlights"], "experience shared highlights"))
      errors.uniq
    end

    def role_errors(role)
      errors = []
      fields = %w[title start_date end_date description]
      errors << "experience role fields must be strings" unless fields.all? { |key| optional?(role[key], String) }
      current = role["is_current"]
      errors << "experience is_current must be a boolean" unless current.nil? || current == true || current == false
      errors + bullet_errors(role["highlights"], "experience highlights")
    end

    # Twenty role lists plus one shared list permit at most 840 bullets per entry.
    def bullet_errors(value, label)
      return [ "#{label} must be a list of strings" ] unless list_of?(value, String)
      return [] if Array(value).size <= TextLimits::MAX_HIGHLIGHTS_PER_ROLE

      [ "#{label} can contain up to #{TextLimits::MAX_HIGHLIGHTS_PER_ROLE} bullets" ]
    end

    # True when the value is nil or of the given class.
    def optional?(value, type)
      value.nil? || value.is_a?(type)
    end

    # True when the value is nil or an array whose elements are all of the given class.
    def list_of?(value, type)
      value.nil? || (value.is_a?(Array) && value.all?(type))
    end
  end
end
