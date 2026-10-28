# An accepted public message. Pending output is never represented as saved history.
module Types
  class ChatMessageType < Types::BaseObject
    field :id, ID, null: false
    field :role, String, null: false
    field :content, String, null: false
    field :position, Integer, null: false
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end
