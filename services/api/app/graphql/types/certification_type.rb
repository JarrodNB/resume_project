# Description: Independent career library certification.
# Index: name, issuer, issued_date, expiry_date, credential_id, credential_url, description
module Types
  class CertificationType < Types::BaseObject
    field :id, ID, null: false
    field :name, String, null: false
    field :issuer, String
    field :issued_date, GraphQL::Types::ISO8601Date
    field :issued_date_precision, String, null: false
    field :expiry_date, GraphQL::Types::ISO8601Date
    field :expiry_date_precision, String, null: false
    field :credential_id, String
    field :credential_url, String
    field :description, String
    field :position, Integer, null: false
  end
end
