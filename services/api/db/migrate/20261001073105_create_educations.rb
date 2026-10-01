# Description: Creates educations (career library): degrees, bootcamps, certifications programs.
class CreateEducations < ActiveRecord::Migration[8.1]
  def change
    create_table :educations, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.string :institution, null: false
      t.string :degree
      t.string :field_of_study
      t.date :start_date
      t.date :end_date
      t.text :description
      t.integer :position, null: false, default: 0

      t.timestamps
    end
  end
end
