# Creates two confirmed, synthetic accounts for development browser checks. Each has a fake paid
# subscription row so QA never hits the trial end (no Stripe is called).
# Existing accounts keep their passwords and saved work. These public fixture
# credentials must never create accounts outside development; see docs/testing.md.
if Rails.env.development?
  User.transaction do
    [
      [ "qa.primary@example.test", "QA Primary" ],
      [ "qa.secondary@example.test", "QA Secondary" ]
    ].each_with_index do |(email, name), index|
      qa_user = User.find_or_create_by!(email: email) do |new_user|
        new_user.name = name
        new_user.password = "local cedar lantern harbor 2026"
        new_user.skip_confirmation!
        new_user.confirmed_at = 30.days.ago
      end
      BillingSubscription.find_or_create_by!(user: qa_user) do |subscription|
        subscription.stripe_customer_id = "cus_seed_#{index + 1}"
        subscription.stripe_subscription_id = "sub_seed_#{index + 1}"
        subscription.status = "active"
        subscription.current_period_end = 10.years.from_now
      end
    end
  end
end
