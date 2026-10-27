# A saved career-library excerpt. No generated answer text or internal ranking scores.
module Types
  class CareerReferenceType < Types::BaseObject
    field :source_type, String, null: false
    field :source_id, ID, null: false
    field :title, String, null: false
    field :body, String, null: false
  end
end
