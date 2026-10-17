# Canonical saved inputs make check identity independent of JSON key order and timestamps.
module AtsChecks
  module Snapshot
    RUBRIC_VERSION = "ats-v1".freeze
    CHECK_KEYS = %w[contact_usability section_labels role_employer dates experience_clarity
                    claim_evidence concise_writing organization repetition placeholders].freeze
    module_function

    def content(resume)
      serialize_sections(resume.sections.reload)
    end

    def serialize_sections(sections)
      sections.map do |section|
        section.attributes.slice("id", "section_type", "title", "position", "content").deep_dup
      end
    end

    def job(resume)
      record = resume.reload.job
      requirements = []
      if record
        [ [ record.requirements, true ], [ record.responsibilities, true ], [ record.nice_to_haves, false ] ].each_with_index do |(list, required), group|
          Array(list).each_with_index do |text, index|
            next unless text.is_a?(String) && text.strip.present?
            requirements << { "id" => "#{group}:#{index}", "text" => text, "required" => required }
          end
        end
      end
      { "requirements" => requirements }
    end

    def fingerprint(value)
      Digest::SHA256.hexdigest(JSON.generate(canonical(value)))
    end

    def canonical(value)
      case value
      when Hash then value.keys.sort.index_with { |key| canonical(value[key]) }
      when Array then value.map { |item| canonical(item) }
      else value
      end
    end
  end
end
