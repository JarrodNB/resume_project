# One bounded recovery page. Cursor advances through the requested committed range
# only after all outcomes in that page have been returned.
module Types
  class AiTaskOutcomePageType < Types::BaseObject
    field :outcomes, [ Types::AiTaskOutcomeType ], null: false
    field :cursor, String, null: false
    field :has_more, Boolean, null: false
  end
end
