# Keep the live job link optional; each interview retains its own source snapshot.
class AddJobToInterviewSessions < ActiveRecord::Migration[8.1]
  def change
    add_reference :interview_sessions, :job, type: :uuid, foreign_key: { on_delete: :nullify }
  end
end
