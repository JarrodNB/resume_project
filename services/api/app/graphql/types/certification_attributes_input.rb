# Description: Editable certification fields shared by create and update.
# Index: name, issuer, issued_date, expiry_date, credential_id, credential_url, description
module Types
  class CertificationAttributesInput < Types::BaseInputObject
    argument :name, String, required: false
    argument :issuer, String, required: false
    argument :issued_date, GraphQL::Types::ISO8601Date, required: false
    argument :issued_date_precision, String, required: false
    argument :expiry_date, GraphQL::Types::ISO8601Date, required: false
    argument :expiry_date_precision, String, required: false
    argument :credential_id, String, required: false
    argument :credential_url, String, required: false
    argument :description, String, required: false
  end
end
