# Chooses how saved interviewer text is spoken. Browser playback is the default for
# real interviews; the provider path remains available by explicit server setting.
module Interviews
  module SpeechPlayback
    def self.mode(interview)
      provider_for_execution_mode?(interview.execution_mode) ? "provider" : "browser"
    end

    def self.provider_for_execution_mode?(execution_mode)
      execution_mode == "fake" || ENV["INTERVIEW_SPEECH_PLAYBACK"] == "provider"
    end

    def self.provider?(interview)
      mode(interview) == "provider"
    end
  end
end
