# Description: Checks that client-supplied ParsedResume JSON has the structure the import walks
# (objects, lists of objects, lists of strings), so a wrong shape becomes an error message
# instead of a crash. Field values are left to model validations.
# Index:
#   - call: returns the parsed resume with string keys, or errors describing each wrong shape
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
      unless Array(parsed_resume["experiences"]).all? { |item| list_of?(item["highlights"], String) }
        errors << "experience highlights must be a list of strings"
      end
      unless Array(parsed_resume["skills"]).all? { |item| optional?(item["name"], String) }
        errors << "skill names must be strings"
      end
      errors
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
