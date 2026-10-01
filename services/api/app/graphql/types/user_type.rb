# frozen_string_literal: true

# Description: The signed-in user.
module Types
  class UserType < Types::BaseObject
    field :id, ID, null: false
    field :email, String, null: false
    field :name, String
  end
end
