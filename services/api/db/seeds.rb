# Creates two confirmed, synthetic accounts for development browser checks. Each gets a trial that
# lasts ten years and the paid daily spend cap, so QA never hits the trial end. They have no Stripe
# records, so upgrading or deleting them works like a real trial account (Stripe test mode).
# Existing accounts keep their passwords and saved work. These public fixture
# credentials must never create accounts outside development; see docs/testing.md.
if Rails.env.development?
  User.transaction do
    [
      [ "qa.primary@example.test", "QA Primary" ],
      [ "qa.secondary@example.test", "QA Secondary" ]
    ].each do |email, name|
      created = false
      qa_user = User.find_or_create_by!(email: email) do |new_user|
        new_user.name = name
        new_user.password = "local cedar lantern harbor 2026"
        new_user.skip_confirmation!
        new_user.confirmed_at = 30.days.ago
        created = true
      end
      # Older seeds gave these accounts fake Stripe ids, which block account deletion. Swap those for
      # the long trial too. Any other existing account is left exactly as it is.
      replaced = BillingSubscription.where(user: qa_user).where("stripe_customer_id LIKE 'cus_seed_%'").delete_all.positive?
      if created || replaced
        qa_user.update!(trial_ends_at: 10.years.from_now, daily_ai_spend_cap_microdollars: PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS)
      end
    end
  end
end
