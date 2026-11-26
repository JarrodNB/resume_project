# Keeps what deleted accounts spent on AI, as daily totals with no user or content, so the
# site-wide trial budget can't be reset by deleting an account.
class CreateDeletedAccountAiSpends < ActiveRecord::Migration[8.1]
  def change
    create_table :deleted_account_ai_spends, id: :uuid do |t|
      t.date :spend_date, null: false
      t.boolean :counts_toward_trial_budget, null: false
      t.bigint :cost_microdollars, null: false, default: 0
      t.bigint :request_count, null: false, default: 0
      t.timestamps
      t.index %i[spend_date counts_toward_trial_budget], unique: true, name: "index_deleted_account_ai_spends_on_day_and_budget"
      t.check_constraint "cost_microdollars >= 0 AND request_count >= 0", name: "deleted_account_ai_spend_nonnegative"
    end
  end
end
