# Keeps each task and embedding receipt in its original site-budget category.
# Historical plan changes were not recorded, so existing rows use the current subscription.
class PreserveTrialBudgetClassification < ActiveRecord::Migration[8.1]
  def up
    %i[ai_tasks ai_embedding_requests].each do |table|
      add_column table, :counts_toward_trial_budget, :boolean, null: false, default: true
      execute <<~SQL
        UPDATE #{table} SET counts_toward_trial_budget = FALSE
        WHERE user_id IN (SELECT user_id FROM billing_subscriptions WHERE status IN ('active', 'past_due'))
      SQL
    end
  end

  def down
    remove_column :ai_tasks, :counts_toward_trial_budget
    remove_column :ai_embedding_requests, :counts_toward_trial_budget
  end
end
