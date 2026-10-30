# Save exact screening fingerprints instead of inferring approvals from earlier tasks.
class AddJobPreferenceScreeningApprovals < ActiveRecord::Migration[8.1]
  def change
    add_column :job_board_listings, :screened_sha256, :string
    add_column :job_preference_profiles, :screened_criteria_sha256, :text, array: true, default: [], null: false
  end
end
