# Keeps a candidate's choices separate from execution settings. Empty configuration
# marks existing sessions, whose original nine-question preparation stays valid.
class AddInterviewSetupConfig < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_sessions, :setup_config, :jsonb, null: false, default: {}
  end
end
