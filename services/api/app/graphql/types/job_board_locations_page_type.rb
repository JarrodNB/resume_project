# Safe US city/state choices; provider failures stay visible and retryable.
module Types
  class JobBoardLocationsPageType < Types::BaseObject
    field :locations, [ Types::JobBoardLocationType ], null: false
    field :errors, [ String ], null: false
  end
end
