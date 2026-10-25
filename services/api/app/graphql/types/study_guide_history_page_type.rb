# A bounded guide-history page and its opaque continuation token.
module Types
  class StudyGuideHistoryPageType < Types::BaseObject
    field :guides, [ Types::StudyGuideSummaryType ], null: false
    field :next_cursor, String
    field :errors, [ String ], null: false
  end
end
