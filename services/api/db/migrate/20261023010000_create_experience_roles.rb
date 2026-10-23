# Adds canonical roles without combining any existing experience entries. Old title/date
# columns remain compatibility projections while consumers move to roles.
class CreateExperienceRoles < ActiveRecord::Migration[8.1]
  def up
    create_table :experience_roles, id: :uuid do |t|
      t.references :experience, null: false, type: :uuid, foreign_key: { on_delete: :cascade }
      t.string :title, null: false
      t.date :start_date
      t.date :end_date
      t.text :description
      t.integer :position, null: false, default: 0
      t.text :screened_fields, array: true, null: false, default: []
      t.timestamps
    end
    add_index :experience_roles, [ :experience_id, :position ], unique: true
    add_index :experience_roles, [ :id, :experience_id ], unique: true
    add_check_constraint :experience_roles, "position >= 0 AND position < 20", name: "experience_role_position_bounds"
    add_check_constraint :experience_roles, "length(trim(title)) > 0 AND length(title) <= 200", name: "experience_role_title_bounds"
    add_check_constraint :experience_roles, "description IS NULL OR length(description) <= 4000", name: "experience_role_description_bounds"
    add_reference :experience_highlights, :experience_role, type: :uuid
    add_foreign_key :experience_highlights, :experience_roles,
                    column: [ :experience_role_id, :experience_id ], primary_key: [ :id, :experience_id ], deferrable: :deferred
    execute <<~SQL
      INSERT INTO experience_roles (experience_id, title, start_date, end_date, position, created_at, updated_at)
      SELECT id, title, start_date, end_date, 0, created_at, updated_at FROM experiences
    SQL
    execute <<~SQL
      UPDATE experience_highlights AS highlights
      SET experience_role_id = roles.id
      FROM experience_roles AS roles
      WHERE highlights.experience_id = roles.experience_id
    SQL
  end

  def down
    # A downgrade is safe only while every canonical role still fits the old flat shape.
    lossy = select_value(<<~SQL)
      SELECT EXISTS (
        SELECT 1 FROM experiences AS entries
        LEFT JOIN experience_roles AS roles ON roles.experience_id = entries.id
        GROUP BY entries.id
        HAVING count(roles.id) <> 1
          OR bool_or(roles.description IS NOT NULL)
          OR bool_or(roles.title IS DISTINCT FROM entries.title
                     OR roles.start_date IS DISTINCT FROM entries.start_date
                     OR roles.end_date IS DISTINCT FROM entries.end_date)
      ) OR EXISTS (
        SELECT 1 FROM experience_highlights WHERE experience_role_id IS NULL
      )
    SQL
    if lossy
      raise ActiveRecord::IrreversibleMigration, "Roles no longer fit the single-role format; export and reconcile grouped data before rollback"
    end

    remove_foreign_key :experience_highlights, column: [ :experience_role_id, :experience_id ]
    remove_reference :experience_highlights, :experience_role
    drop_table :experience_roles
  end
end
