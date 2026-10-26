# The initial feed message is a baseline cursor with no outcome. Subsequent messages
# each carry one durable occurrence, so clients can start catch-up after registration.
module Types
  class AiTaskOutcomeFeedType < Types::BaseObject
    field :cursor, String, null: false
    field :outcome, Types::AiTaskOutcomeType
  end
end
