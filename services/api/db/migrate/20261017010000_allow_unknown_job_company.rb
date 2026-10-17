# An advertisement can omit the employer. Keep that absence as null rather than guessing.
class AllowUnknownJobCompany < ActiveRecord::Migration[8.1]
  def up
    change_column_null :jobs, :company, true
  end

  def down
    if select_value("SELECT EXISTS (SELECT 1 FROM jobs WHERE company IS NULL)")
      raise ActiveRecord::IrreversibleMigration, "Fill missing job companies before restoring NOT NULL"
    end

    change_column_null :jobs, :company, false
  end
end
