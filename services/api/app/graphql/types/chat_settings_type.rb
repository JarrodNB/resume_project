# Effective server settings; the browser must not infer limits from its own environment.
module Types
  class ChatSettingsType < Types::BaseObject
    field :max_input_characters, Integer, null: false
    field :summarize_every_user_messages, Integer, null: false
  end
end
