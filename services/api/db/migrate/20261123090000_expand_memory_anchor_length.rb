# Sentence-by-sentence recall cues need room for the answer’s complete structure.
class ExpandMemoryAnchorLength < ActiveRecord::Migration[8.1]
  def up
    change_column :interview_questions, :memory_anchor, :string, limit: 600, default: "", null: false
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Shortening anchors could lose saved cues"
  end
end
