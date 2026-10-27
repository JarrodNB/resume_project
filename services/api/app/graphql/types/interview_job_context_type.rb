# Public saved vacancy details frozen for this session, separate from private career evidence.
# The optional id is a live navigation link and disappears when the original job is deleted.
module Types
  class InterviewJobContextType < Types::BaseObject
    field :id, ID, null: true
    field :title, String, null: false
    field :company, String, null: true
    field :description, String, null: true
    field :requirements, [ String ], null: false
    field :responsibilities, [ String ], null: false
    field :nice_to_haves, [ String ], null: false
  end
end
