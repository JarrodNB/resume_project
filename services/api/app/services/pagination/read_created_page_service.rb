# Reads newest-first windows from an already-authorized relation using a signed scoped cursor.
# Callers choose the records, page size and presentation; this module owns cursor verification,
# timestamp/id continuation, deterministic ordering and next-page detection.
module Pagination
  class ReadCreatedPageService < ApplicationService
    def initialize(records:, cursor:, binding:, purpose:, limit:)
      @records, @cursor, @binding, @purpose, @limit = records, cursor, binding, purpose, limit
    end

    def call
      scope = @records
      if @cursor.present?
        position = verifier.verified(@cursor, purpose: @purpose)
        return failure("Invalid cursor") unless position.is_a?(Hash) && @binding.all? { |key, value| position[key] == value }

        scope = scope.where("(created_at, id) < (?, ?)", Time.iso8601(position.fetch("created_at")), position.fetch("id"))
      end
      rows = scope.reorder(created_at: :desc, id: :desc).limit(@limit + 1).to_a
      page = rows.first(@limit)
      next_cursor = if rows.size > @limit
        last = page.last
        verifier.generate(@binding.merge("created_at" => last.created_at.iso8601(6), "id" => last.id), purpose: @purpose)
      end
      success(records: page, next_cursor: next_cursor)
    rescue ArgumentError, KeyError
      failure("Invalid cursor")
    end

    private

    def verifier
      Rails.application.message_verifier(@purpose)
    end
  end
end
