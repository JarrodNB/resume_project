# Server-owned execution presets travel with the saved session. Changing runtime
# settings never converts an existing scripted interview into a paid interview.
module Interviews
  module ExecutionConfiguration
    FAKE = { "transcription_model" => "fake-transcription-v1", "interviewer_model" => "fake-interviewer-v1",
      "speech_model" => "fake-speech-v1", "voice" => "espeak" }.freeze
    REAL = { "transcription_model" => "gpt-transcribe", "interviewer_model" => "gpt-6-luna",
      "speech_model" => "gpt-4o-mini-tts", "voice" => "marin" }.freeze
    PRESETS = { "fake" => FAKE, "real" => REAL }.freeze
  end
end
