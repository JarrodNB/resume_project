# Description: Allows career-relevant subject knowledge practice while retaining legacy scopes.
# Index:
#   - up: expands the allowed immutable set types
#   - down: restores the prior constraint when no knowledge sets remain
class AllowKnowledgeInterviewQuestionSets < ActiveRecord::Migration[8.1]
  # Allows the new scope without rewriting existing sets or their default.
  def up
    remove_check_constraint :interview_question_sets, name: "interview_question_sets_valid_set_type"
    add_check_constraint :interview_question_sets, "set_type IN ('general', 'technical', 'knowledge')",
                         name: "interview_question_sets_valid_set_type"
  end

  # Refuses rollback if knowledge sets would violate the previous constraint.
  def down
    remove_check_constraint :interview_question_sets, name: "interview_question_sets_valid_set_type"
    add_check_constraint :interview_question_sets, "set_type IN ('general', 'technical')",
                         name: "interview_question_sets_valid_set_type"
  end
end
