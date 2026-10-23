# Allows a single transaction to swap ordered roles without temporary invalid positions.
class DeferExperienceRolePositions < ActiveRecord::Migration[8.1]
  def up
    remove_index :experience_roles, [ :experience_id, :position ]
    execute "ALTER TABLE experience_roles ADD CONSTRAINT experience_roles_position_unique UNIQUE (experience_id, position) DEFERRABLE INITIALLY DEFERRED"
  end

  def down
    execute "ALTER TABLE experience_roles DROP CONSTRAINT experience_roles_position_unique"
    add_index :experience_roles, [ :experience_id, :position ], unique: true
  end
end
