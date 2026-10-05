# frozen_string_literal: true

# Description: The user's answer to one requirement of one job. `library_fact` is set when that
# answer was also added to the career library.
module Types
  class JobGapResponseType < Types::BaseObject
    field :id, ID, null: false
    field :requirement, String, null: false
    field :body, String, null: false
    field :library_fact, Types::LibraryFactType, null: true
  end
end
