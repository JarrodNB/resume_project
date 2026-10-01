# frozen_string_literal: true

# Description: One ordered section of a resume. `content` is a JSON snapshot.
module Types
  class ResumeSectionType < Types::BaseObject
    field :id, ID, null: false
    field :section_type, Types::ResumeSectionTypeEnum, null: false
    field :title, String, null: false
    field :position, Integer, null: false
    field :content, GraphQL::Types::JSON, null: false
  end
end
