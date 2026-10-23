# Keeps one hourly admission for a prepared interview while retaining separate task bills.
# Existing tasks remain ordinary admissions; removing a parent never deletes a child's usage.
class LinkInterviewHourlyAdmissions < ActiveRecord::Migration[8.1]
  def change
    add_reference :ai_tasks, :hourly_admission_task, type: :uuid,
      foreign_key: { to_table: :ai_tasks, on_delete: :nullify }
    add_check_constraint :ai_tasks,
      "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)",
      name: "ai_task_hourly_interview_child"
  end
end
