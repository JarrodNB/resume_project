# Public submission progress; never exposes leases, private snapshots or execution credentials.
module Types
  class ChatOperationType < Types::BaseObject
    field :id, ID, null: false
    field :status, String, null: false
    field :message, String, null: false
    field :failure_code, String
    field :retry_at, GraphQL::Types::ISO8601DateTime
    field :attempt_id, ID
    field :claim_generation, Integer, null: false
    field :execution_count, Integer, null: false
    field :idempotency_key, String, null: false
    field :updated_at, String, null: false

    def updated_at
      object.updated_at.iso8601(6)
    end
  end
end
