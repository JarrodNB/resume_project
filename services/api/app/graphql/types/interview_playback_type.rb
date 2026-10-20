# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewPlaybackType < Types::BaseObject
    field :playback_url, String, null: false
    field :expires_in, Integer, null: false
    field :content_type, String, null: false
  end
end
