# Keep selected provider experience levels valid and in one stable order.
# An empty list means no restriction; invalid values return nil rather than being ignored.
module JobBoard
  module ExperienceLevels
    VALUES = %w[EN MI SE EX].freeze

    def self.normalize(levels)
      return unless levels.is_a?(Array) && levels.all? { |level| VALUES.include?(level) }

      VALUES.select { |level| levels.include?(level) }
    end
  end
end
