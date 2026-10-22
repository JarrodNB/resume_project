# Defines the frozen choices for a prepared interview. Missing saved configuration
# belongs to older nine-question sessions; new starts use the current defaults.
module Interviews
  module SetupConfiguration
    QUESTION_COUNTS = [ 5, 8, 12 ].freeze
    QUESTION_TYPES = %w[behavioral technical knowledge].freeze
    DEFAULT = { "question_count" => 8 }.freeze
    LEGACY = { "question_count" => 9 }.freeze

    def self.valid?(value)
      value.is_a?(Hash) && value.keys == [ "question_count" ] && value["question_count"].is_a?(Integer) && QUESTION_COUNTS.include?(value["question_count"])
    end

    def self.for(interview)
      interview.setup_config.presence || LEGACY
    end

    def self.question_types(interview)
      Array.new(self.for(interview).fetch("question_count")) { |index| QUESTION_TYPES[index % QUESTION_TYPES.size] }
    end
  end
end
