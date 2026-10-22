# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewSessionMessageType < Types::BaseObject
    field :id, ID, null: false
    field :question_id, ID, null: false
    field :kind, String, null: false
    field :position, Integer, null: false
    field :content, String, null: false
    field :acknowledgement, String, null: true
    field :spoken_content, String, null: false

    def spoken_content
      Interviews::MessageText.spoken_content(object)
    end
  end
end
