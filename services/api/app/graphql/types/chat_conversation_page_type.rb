# A bounded saved-chat list with an opaque continuation cursor.
module Types
  class ChatConversationPageType < Types::BaseObject
    field :conversations, [ Types::ChatConversationType ], null: false
    field :next_cursor, String
    field :errors, [ String ], null: false
  end
end
