# Public saved-chat metadata. Model inputs and private execution records are not exposed here.
module Types
  class ChatConversationType < Types::BaseObject
    field :latest_operation, Types::ChatOperationType

    def latest_operation
      object.operations.order(created_at: :desc, id: :desc).first
    end

    field :id, ID, null: false
    field :title, String, null: false
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
    field :updated_at, GraphQL::Types::ISO8601DateTime, null: false
    field :messages, Types::ChatMessagePageType, null: false do
      argument :cursor, String, required: false
    end

    def messages(cursor: nil)
      result = ::Chat::ListMessagesService.call(conversation: object, cursor: cursor)
      result.value || { messages: [], next_cursor: nil, errors: result.errors }
    end
  end
end
