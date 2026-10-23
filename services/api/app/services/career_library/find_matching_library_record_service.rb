# Finds a conservative duplicate among the user's existing library entries. Experience
# matching compares its complete ordered role/date/scope structure, never company alone.
# Other entry kinds compare normalized identifying fields and compatible start dates.
module CareerLibrary
  class FindMatchingLibraryRecordService < ApplicationService
    MATCH_FIELDS = {
      Project => %w[name],
      Education => %w[institution degree],
      Certification => %w[name issuer]
    }.freeze

    # @param record [Experience, Project, Education, Certification] saved or unsaved record to look up
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

    # True when every identifying field matches and the start/issued dates don't conflict.
    def matches?(candidate)
      return Experiences::EntryStructure.matches?(candidate, @record) if @record.is_a?(Experience)

      MATCH_FIELDS.fetch(@record.class).all? { |field| normalize(candidate[field]) == normalize(@record[field]) } &&
        start_dates_compatible?(candidate)
    end

    # False only when both records have start/issued dates and they differ.
    def start_dates_compatible?(candidate)
      date_field = @record.is_a?(Certification) ? :issued_date : :start_date
      candidate[date_field].nil? || @record[date_field].nil? || candidate[date_field] == @record[date_field]
    end

    # Lowercases and squishes a value; nil and blank become "".
    def normalize(value)
      value.to_s.squish.downcase
    end
  end
end
