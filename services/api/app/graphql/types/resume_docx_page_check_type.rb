# Exposes pagination metadata only; private document keys and converter diagnostics stay server-side.
module Types
  class ResumeDocxPageCheckType < Types::BaseObject
    field :id, ID, null: false
    field :status, String, null: false
    field :content_digest, String, null: false
    field :page_count, Integer, null: true
    field :error_code, String, null: true
    field :expires_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end
