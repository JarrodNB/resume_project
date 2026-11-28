# The live interviewer's spoken feedback for a question (saved as text, latest only) and how many
# times the candidate restarted the question (at most two), kept durable so an agent restart
# cannot give extra retries.
class AddLiveCoachingToInterviewSessionQuestions < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_session_questions, :live_feedback, :text
    add_column :interview_session_questions, :live_retry_count, :integer, null: false, default: 0
    add_check_constraint :interview_session_questions,
      "live_feedback IS NULL OR char_length(live_feedback) BETWEEN 1 AND 1500", name: "interview_question_live_feedback"
    add_check_constraint :interview_session_questions,
      "live_retry_count BETWEEN 0 AND 2", name: "interview_question_live_retry_count"
  end
end
