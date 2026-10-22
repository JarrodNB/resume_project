# Keeps accepted question text separate from the acknowledgement of the last answer.
# Playback and restored dialogue use this exact composition; clarification reads content alone.
module Interviews
  module MessageText
    def self.spoken_content(message)
      [ message.acknowledgement, message.content ].compact.join("\n\n")
    end
  end
end
