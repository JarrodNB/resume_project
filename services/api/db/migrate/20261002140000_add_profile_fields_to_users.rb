# Description: Contact details and summary on the user's profile (filled from an imported resume,
# copied into tailored resumes).
class AddProfileFieldsToUsers < ActiveRecord::Migration[8.1]
  def change
    change_table :users, bulk: true do |t|
      t.string :contact_email
      t.string :phone
      t.string :location
      t.jsonb :links, null: false, default: []
      t.text :summary
    end
  end
end
