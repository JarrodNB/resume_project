# frozen_string_literal: true

# Description: A career-library fact created from a gap response.
module Types
  class LibraryFactType < Types::BaseObject
    field :id, ID, null: false
    field :requirement, String, null: false
    field :response, String, null: false
  end
end
