# Stores each user's paid subscription as last reported by the payment provider.
# Rails reads this table to decide whether a user is on the paid plan; it never calls the provider.
class CreateBillingSubscriptions < ActiveRecord::Migration[8.1]
  def change
    create_table :billing_subscriptions, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true, index: { unique: true }
      t.string :stripe_customer_id, null: false
      t.string :stripe_subscription_id
      t.string :status, null: false
      t.datetime :current_period_end
      t.boolean :cancel_at_period_end, null: false, default: false
      t.timestamps
    end
    add_index :billing_subscriptions, :stripe_customer_id, unique: true
    add_index :billing_subscriptions, :stripe_subscription_id, unique: true
  end
end
