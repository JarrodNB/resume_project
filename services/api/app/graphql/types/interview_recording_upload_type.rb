# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewRecordingUploadType < Types::BaseObject
    field :media_id, ID, null: false
    field :upload_url, String, null: false
    field :headers, GraphQL::Types::JSON, null: false
    field :expires_in, Integer, null: false
  end
end
