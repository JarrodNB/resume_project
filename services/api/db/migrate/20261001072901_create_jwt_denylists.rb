# Description: Creates the JWT denylist used by devise-jwt to revoke tokens on sign-out.
class CreateJwtDenylists < ActiveRecord::Migration[8.1]
  def change
    create_table :jwt_denylists, id: :uuid do |t|
      t.string :jti, null: false
      t.datetime :exp, null: false

      t.timestamps
    end
    add_index :jwt_denylists, :jti, unique: true
  end
end
