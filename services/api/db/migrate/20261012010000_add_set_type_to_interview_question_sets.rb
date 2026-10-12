# Description: Labels existing practice sets as general and constrains future scopes.
# Index:
#   - change: adds the required set type and allowed-value constraint
class AddSetTypeToInterviewQuestionSets < ActiveRecord::Migration[8.1]
  # Backfills legacy sets using the same default as legacy queue messages.
  def change
    add_column :interview_question_sets, :set_type, :string, null: false, default: "general"
    add_check_constraint :interview_question_sets, "set_type IN ('general', 'technical')",
                         name: "interview_question_sets_valid_set_type"
  end
end
