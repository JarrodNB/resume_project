# Public dialogue excludes raw model messages, tool arguments and system instructions.
module Types
  class JobPreferenceConversationTurnType < Types::BaseObject
    field :user_message, String, null: false
    field :assistant_message, String, null: false
  end
end
