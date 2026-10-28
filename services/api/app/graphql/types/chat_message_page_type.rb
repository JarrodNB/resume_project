# A bounded chronological window of accepted chat messages with an older-history cursor.
module Types
  class ChatMessagePageType < Types::BaseObject
    field :messages, [ Types::ChatMessageType ], null: false
    field :next_cursor, String
    field :errors, [ String ], null: false
  end
end
