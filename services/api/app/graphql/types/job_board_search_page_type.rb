# Preserves search order with freshness metadata and safe errors. Retrieval time
# is absent when the provider failed without a previously successful cached page.
module Types
  class JobBoardSearchPageType < Types::BaseObject
    field :listings, [ Types::JobBoardListingType ], null: false
    field :next_cursor, String
    field :retrieved_at, GraphQL::Types::ISO8601DateTime
    field :stale, Boolean, null: false
    field :errors, [ String ], null: false
  end
end
