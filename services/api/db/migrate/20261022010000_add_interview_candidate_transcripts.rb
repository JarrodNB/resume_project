# Keep finalized candidate input with its immutable submission until interview content expires.
class AddInterviewCandidateTranscripts < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_session_operations, :candidate_transcript, :text
    add_column :interview_session_operations, :transcription_mode, :string, null: false, default: "recorded"
    add_check_constraint :interview_session_operations, "transcription_mode IN ('recorded', 'browser', 'streaming')", name: "interview_operation_transcription_mode"
    add_check_constraint :interview_session_operations, "candidate_transcript IS NULL OR (char_length(candidate_transcript) BETWEEN 1 AND 4000 AND transcription_mode <> 'recorded')", name: "interview_operation_candidate_transcript"
  end
end
