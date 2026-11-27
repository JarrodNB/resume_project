# frozen_string_literal: true

# Description: How a spoken interview is held, chosen when preparation starts and never changed:
# TURN_BASED (hear a question, then send a recorded or typed answer) or LIVE (a real-time
# conversation with the interviewer in a LiveKit room).
module Types
  class ConversationModeEnum < Types::BaseEnum
    extend EnumFromValues
    values_from InterviewSession::CONVERSATION_MODES
  end
end
