# Saves a short public bridge before an interviewer question without changing question text.
# Historical messages remain unchanged, and candidate answers cannot carry acknowledgements.
class AddInterviewMessageAcknowledgements < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_session_messages, :acknowledgement, :text
    add_check_constraint :interview_session_messages,
      "acknowledgement IS NULL OR (kind <> 'answer' AND char_length(acknowledgement) BETWEEN 1 AND 280 AND btrim(acknowledgement) <> '')",
      name: "interview_message_acknowledgement"
  end
end
