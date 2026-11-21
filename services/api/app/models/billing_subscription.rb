# A user's paid subscription and its status, as last reported by the payment provider.
# "Paid" means the status is active or past_due (the provider is still retrying the card).
class BillingSubscription < ApplicationRecord
  PAID_STATUSES = %w[active past_due].freeze

  belongs_to :user

  validates :stripe_customer_id, :status, presence: true

  scope :paid, -> { where(status: PAID_STATUSES) }
end
