# A user's paid subscription and its status, as last reported by the payment provider.
# "Paid" means the status is active or past_due (the provider is still retrying the card).
# A row with no status yet only remembers the Stripe customer for a user who has not subscribed.
class BillingSubscription < ApplicationRecord
  PAID_STATUSES = %w[active past_due].freeze

  belongs_to :user

  validates :stripe_customer_id, presence: true

  scope :paid, -> { where(status: PAID_STATUSES) }

  # The one rule for "paid", for a stored row or a status read from the provider.
  def self.paid_status?(status) = PAID_STATUSES.include?(status)

  def paid? = self.class.paid_status?(status)
end
