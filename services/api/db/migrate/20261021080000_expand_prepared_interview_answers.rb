# Allows three responses on new prepared sessions while retaining historical cap defaults.
class ExpandPreparedInterviewAnswers < ActiveRecord::Migration[8.1]
  def change
    remove_check_constraint :interview_sessions, name: "interview_session_counters"
    add_check_constraint :interview_sessions, "revision >= 0 AND current_question_position >= 0 AND answer_cap BETWEEN 1 AND 3", name: "interview_session_counters"
    remove_check_constraint :interview_session_questions, name: "interview_session_question_counters"
    add_check_constraint :interview_session_questions, "position >= 0 AND accepted_answer_count BETWEEN 0 AND 3 AND history_version > 0", name: "interview_session_question_counters"
  end
end
