# A resolved US city or state. Kind determines which search filter receives its ID.
module Types
  class JobBoardLocationType < Types::BaseObject
    field :kind, String, null: false
    field :provider_id, Integer, null: false
    field :label, String, null: false
  end
end
