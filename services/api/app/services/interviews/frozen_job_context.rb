# Copies saved vacancy expectations without treating them as the candidate's experience.
# Screening sources retain typed values so list approvals cannot cover edited bullets.
module Interviews
  module FrozenJobContext
    FIELDS = %w[title company description requirements responsibilities nice_to_haves].freeze

    def self.snapshot(job)
      job.attributes.slice("id", *FIELDS)
    end

    def self.render(value)
      value.is_a?(Array) ? value.map { |item| "- #{item}" }.join("\n") : value
    end

    def self.sources(job)
      FIELDS.filter_map do |field|
        value = job[field]
        next if value.blank?
        { type: "jobs", id: job.id, field: field, value: value, text: render(value), screened: job.screened_fields.include?(field) }
      end
    end

    def self.valid_source?(source)
      value = source["value"]
      valid_value = if %w[requirements responsibilities nice_to_haves].include?(source["field"])
        value.is_a?(Array) && value.all? { |item| item.is_a?(String) }
      else
        value.is_a?(String)
      end
      FIELDS.include?(source["field"]) && valid_value && source["text"] == render(value)
    end
  end
end
