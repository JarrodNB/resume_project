# Allows saved HR screening questions alongside the existing question categories.
# Existing sessions keep their saved categories and question order.
class AllowScreeningInterviewQuestions < ActiveRecord::Migration[8.1]
  def change
    remove_check_constraint :interview_session_questions,
      "question_type IN ('behavioral', 'technical', 'knowledge')", name: "interview_question_type"
    add_check_constraint :interview_session_questions,
      "question_type IN ('behavioral', 'technical', 'knowledge', 'screening')", name: "interview_question_type"
  end
end
