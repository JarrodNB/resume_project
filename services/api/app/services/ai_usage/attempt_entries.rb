# Saves and reads one execution attempt's usage entries as typed rows.
# Callers hold the task lock and apply the returned total changes to the task, so
# task totals always equal the sum of its entry rows. Keys outside the known
# columns are dropped with a warning rather than failing result delivery.
module AiUsage
  module AttemptEntries
    TEXT_FIELDS = %w[stage provider model provider_response_id].freeze
    COUNT_FIELDS = %w[input_tokens cached_input_tokens cache_write_tokens output_tokens audio_milliseconds characters cost_microdollars].freeze
    FIELDS = (TEXT_FIELDS + COUNT_FIELDS).freeze

    # Replaces the attempt's rows and returns new minus old sums for each task total column.
    def self.replace(attempt, entries)
      previous = totals(attempt.usage_entries)
      attempt.usage_entries.delete_all
      rows = normalize(entries).each_with_index.map do |entry, position|
        # insert_all needs the same keys on every row.
        FIELDS.index_with { |field| entry[field] }
          .merge("ai_usage_attempt_id" => attempt.id, "ai_task_id" => attempt.ai_task_id, "position" => position)
      end
      AiUsageEntry.insert_all!(rows) if rows.any?
      attempt.usage_entries.reset
      current = totals(rows)
      AiTasks::RecordAttemptUsageService::COLUMNS.index_with { |column| current[column] - previous[column] }
    end

    # Rebuilds the reported list shape, leaving out fields the provider did not report.
    def self.as_hashes(attempt)
      attempt.usage_entries.map { |entry| entry.attributes.slice(*FIELDS).compact }
    end

    # True when the saved rows hold exactly these entries.
    def self.matches?(attempt, entries)
      as_hashes(attempt) == normalize(entries)
    end

    def self.normalize(entries)
      Array(entries).map do |entry|
        unknown = entry.keys - FIELDS
        Rails.logger.warn("Dropped unknown AI usage fields: #{unknown.join(', ')}") if unknown.any?
        entry.slice(*FIELDS).compact
      end
    end
    private_class_method :normalize

    def self.totals(entries)
      AiTasks::RecordAttemptUsageService::COLUMNS.index_with do |column|
        entries.sum { |entry| (entry.is_a?(Hash) ? entry[column] : entry.public_send(column)).to_i }
      end
    end
    private_class_method :totals
  end
end
