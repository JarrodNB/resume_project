# Resolves the latest saved answerable prompt; acknowledgements and answers never enter clarification.
module Interviews
  module ClarificationPrompt
    def self.current?(interview, message)
      interview.execution_mode == "real" && interview.active? && interview.expires_at > Time.current && message &&
        message.question.position == interview.current_question_position &&
        interview.messages.where(question_id: message.question_id, kind: %w[opening follow_up]).order(:position).last&.id == message.id
    end
  end
end
