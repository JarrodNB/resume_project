# Keep each owner's editable next-job criteria separate from the last confirmed revision.
class CreateJobPreferenceProfiles < ActiveRecord::Migration[8.1]
  def change
    create_table :job_preference_profiles, id: :uuid do |t|
      t.references :user, null: false, type: :uuid, foreign_key: true, index: { unique: true }
      t.integer :version, null: false, default: 0
      t.integer :confirmed_revision, null: false, default: 0
      t.jsonb :draft_criteria, null: false, default: []
      t.jsonb :confirmed_criteria, null: false, default: []
      t.timestamps
    end
    add_check_constraint :job_preference_profiles, "version >= 0 AND confirmed_revision >= 0 AND confirmed_revision <= version", name: "job_preferences_valid_revisions"
  end
end
