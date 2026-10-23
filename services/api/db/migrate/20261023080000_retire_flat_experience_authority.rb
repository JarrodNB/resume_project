# Keeps old columns for staged deploys, but permits canonical writers to leave them empty.
# Their historic values are retained as recovery evidence, never used by current readers.
class RetireFlatExperienceAuthority < ActiveRecord::Migration[8.1]
  def up
    if select_value("SELECT EXISTS (SELECT 1 FROM experiences WHERE NOT EXISTS (SELECT 1 FROM experience_roles WHERE experience_id = experiences.id))")
      raise ActiveRecord::MigrationError,
            "Stop old writers and reconcile entries without canonical roles before retiring flat authority"
    end
    change_column_null :experiences, :title, true
  end

  def down
    raise ActiveRecord::IrreversibleMigration,
          "Canonical roles may have changed; restore a compatible application without dropping roles or reconstructing flat history"
  end
end
