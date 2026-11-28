# Keeps turn-based actions away from live interviews. A live interview is answered by speaking in
# the live room, where the live agent saves prompts and answers through its own callbacks; the
# turn-based actions (submitting or skipping a turn, recording or transcribing an answer, asking
# for a clarification or avoiding a prompt) must not change it or spend on it. Each of those
# services asks here first. Career references, session feedback, ending the live room and
# abandoning still work for live interviews.
module Interviews
  module TurnBasedOnly
    MESSAGE = "This is a live interview".freeze

    # @return [ServiceResult, nil] a failure for a live interview, nil for a turn-based one
    def self.refusal(interview)
      ServiceResult.new(success: false, value: nil, errors: [ MESSAGE ]) if interview.conversation_live?
    end
  end
end
