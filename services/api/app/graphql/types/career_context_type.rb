# frozen_string_literal: true

# Description: A career context created from a gap response.
module Types
  class CareerContextType < Types::BaseObject
    field :id, ID, null: false
    field :requirement, String, null: false
    field :response, String, null: false
  end
end
