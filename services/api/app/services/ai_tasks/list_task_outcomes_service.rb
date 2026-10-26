# Reads a bounded committed range for the owner's reconnect recovery. Owner-first
# terminal writes serialize sequence allocation through commit, so advancing through
# a confirmed subscription cursor cannot skip a lower uncommitted occurrence.
module AiTasks
  class ListTaskOutcomesService < ApplicationService
    MAX_CURSOR = 2**63 - 1

    def initialize(outcomes:, after:, through:, limit: 100)
      @outcomes, @after, @through, @limit = outcomes, after, through, limit
    end

    # @return [ServiceResult<Hash>] ordered outcomes, next cursor and remaining-page flag
    def call
      unless valid_cursor?(@after) && valid_cursor?(@through) && @after.to_i <= @through.to_i && @limit.is_a?(Integer) && @limit.between?(1, 100)
        return failure("Invalid task outcome range")
      end
      current_cursor = @outcomes.maximum(:sequence) || 0
      upper = [ @through.to_i, current_cursor ].min
      # A checkpoint restored from another database must not suppress all future work.
      return success({ outcomes: [], cursor: current_cursor.to_s, has_more: false }) if @after.to_i > current_cursor
      rows = @outcomes.where(sequence: (@after.to_i + 1)..upper)
        .includes(:user, :ai_task).order(:sequence).limit(@limit + 1).to_a
      has_more = rows.length > @limit
      rows = rows.first(@limit)
      success({ outcomes: rows, cursor: has_more ? rows.last.sequence.to_s : upper.to_s, has_more: has_more })
    end

    private

    def valid_cursor?(value)
      value.is_a?(String) && value.match?(/\A(?:0|[1-9][0-9]{0,18})\z/) && value.to_i <= MAX_CURSOR
    end
  end
end
