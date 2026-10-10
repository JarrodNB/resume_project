# Description: Creates independent user-owned certification entries; preserves education rows.
# Index: change creates certifications and its owner foreign key
class CreateCertifications < ActiveRecord::Migration[8.1]
  # Creates the certification library table.
  def change
    create_table :certifications, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.string :name, null: false
      t.string :issuer
      t.date :issued_date
      t.date :expiry_date
      t.string :credential_id
      t.string :credential_url
      t.text :description
      t.integer :position, null: false, default: 0
      t.timestamps
    end
  end
end
