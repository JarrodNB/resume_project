# Description: Date ordering for dated career library entries (experiences, projects, educations).
# Ongoing entries (a start date but no end date) come first, newest start first; then finished
# entries by end date, newest first; entries with no dates at all come last.
# Index:
#   - most_recent_first: scope applying that order (ties broken by position)
module MostRecentFirst
  extend ActiveSupport::Concern

  ORDER_SQL = <<~SQL.squish.freeze
    (end_date IS NULL AND start_date IS NOT NULL) DESC,
    end_date DESC NULLS LAST,
    start_date DESC NULLS LAST,
    position
  SQL

  included do
    scope :most_recent_first, -> { order(Arel.sql(ORDER_SQL)) }
  end
end
