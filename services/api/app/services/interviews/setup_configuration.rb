# Defines the frozen choices for a prepared interview. Missing saved configuration
# belongs to older nine-question sessions; new starts use the current defaults.
module Interviews
  module SetupConfiguration
    QUESTION_COUNTS = [ 5, 8, 12 ].freeze
    QUESTION_TYPES = %w[behavioral technical knowledge].freeze
    QUESTION_TYPE_CYCLES = { "mixed" => QUESTION_TYPES, "behavioral" => %w[behavioral].freeze,
      "technical" => %w[technical knowledge].freeze, "screening" => %w[screening].freeze }.freeze
    QUESTION_FORMATS = QUESTION_TYPE_CYCLES.keys.freeze
    DIFFICULTIES = %w[warm_up realistic stretch].freeze
    INTERVIEWERS = %w[maya daniel priya].freeze
    FOCUS_AREAS = %w[communication problem_solving leadership teamwork conflict impact_metrics technical_depth adaptability ownership customer_focus].freeze
    STYLE_DEFAULTS = { "difficulty" => "realistic", "interviewer" => "daniel", "focus_areas" => [].freeze }.freeze
    DEFAULT = STYLE_DEFAULTS.merge("question_count" => 8, "question_format" => "mixed").freeze
    LEGACY = DEFAULT.merge("question_count" => 9).freeze

    def self.valid?(value)
      value.is_a?(Hash) && value.keys.sort == DEFAULT.keys.sort && value["question_count"].is_a?(Integer) &&
        QUESTION_COUNTS.include?(value["question_count"]) && QUESTION_FORMATS.include?(value["question_format"]) &&
        DIFFICULTIES.include?(value["difficulty"]) && INTERVIEWERS.include?(value["interviewer"]) &&
        value["focus_areas"].is_a?(Array) && value["focus_areas"].uniq == value["focus_areas"] &&
        (value["focus_areas"] - FOCUS_AREAS).empty?
    end

    def self.for(interview)
      LEGACY.merge(interview.setup_config)
    end

    def self.question_types(interview)
      setup = self.for(interview)
      cycle = QUESTION_TYPE_CYCLES.fetch(setup.fetch("question_format"))
      Array.new(setup.fetch("question_count")) { |index| cycle[index % cycle.size] }
    end
  end
end
