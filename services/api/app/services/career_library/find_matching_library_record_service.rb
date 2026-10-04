# Description: Finds the existing career library record that a record duplicates. Text compares
# case-insensitively with whitespace squished; if both records have a start date, the dates must
# be equal (so a second stint at the same company stays its own role).
# Index:
#   - MATCH_FIELDS: identifying fields per model
#   - call: returns the first matching candidate, or nil
module CareerLibrary
  class FindMatchingLibraryRecordService < ApplicationService
    MATCH_FIELDS = {
      Experience => %w[company title],
      Project => %w[name],
      Education => %w[institution degree]
    }.freeze

    # @param record [Experience, Project, Education] saved or unsaved record to look up
    # @param candidates [Enumerable] the user's existing records of the same model
    def initialize(record:, candidates:)
      @record = record
      @candidates = candidates
    end

    # Returns the first candidate that matches the record (never the record itself).
    def call
      success(@candidates.find { |candidate| candidate != @record && matches?(candidate) })
    end

    private

    # True when every identifying field matches and the start dates don't conflict.
    def matches?(candidate)
      MATCH_FIELDS.fetch(@record.class).all? { |field| normalize(candidate[field]) == normalize(@record[field]) } &&
        start_dates_compatible?(candidate)
    end

    # False only when both records have start dates and they differ.
    def start_dates_compatible?(candidate)
      candidate.start_date.nil? || @record.start_date.nil? || candidate.start_date == @record.start_date
    end

    # Lowercases and squishes a value; nil and blank become "".
    def normalize(value)
      value.to_s.squish.downcase
    end
  end
end
