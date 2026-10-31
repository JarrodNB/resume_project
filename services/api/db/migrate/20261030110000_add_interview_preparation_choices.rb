# Retains only preparation choices when legacy source packages become inert.
class AddInterviewPreparationChoices < ActiveRecord::Migration[8.1]
  def up
    add_column :interview_sessions, :career_focus, :string, null: false, default: ""
    add_column :interview_sessions, :preparation_kind, :string, null: false, default: "fictional_role"
    execute <<~SQL
      UPDATE interview_sessions SET
        career_focus = COALESCE(frozen_context->>'career_focus', ''),
        preparation_kind = CASE WHEN frozen_context ? 'job' OR job_id IS NOT NULL THEN 'saved_job' ELSE 'fictional_role' END,
        prepared_role = CASE WHEN frozen_context ? 'job' OR job_id IS NOT NULL THEN '{}'::jsonb ELSE prepared_role END,
        frozen_context = '{}'::jsonb
    SQL
    add_check_constraint :interview_sessions, "preparation_kind IN ('saved_job', 'fictional_role')", name: "interview_preparation_kind"
    add_check_constraint :interview_sessions, "char_length(career_focus) <= 200", name: "interview_career_focus_length"
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Legacy interview source copies were removed"
  end
end
