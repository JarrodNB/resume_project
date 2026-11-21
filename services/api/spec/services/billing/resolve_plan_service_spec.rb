# Description: Which plan a user is on (trial, paid or ended) and their hidden daily spend cap.
require "rails_helper"

RSpec.describe Billing::ResolvePlanService do
  let(:user) { create(:user) }

  def plan_for(user) = described_class.call(user: user).value

  it "puts a user inside their trial window on the trial plan with the trial cap" do
    user.update!(trial_ends_at: 3.days.from_now)

    expect(plan_for(user)).to have_attributes(plan: "trial", trial_ends_at: user.trial_ends_at,
      daily_spend_cap_microdollars: TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS, ai_access?: true)
  end

  it "ends the plan once the trial is over and there is no subscription" do
    user.update!(trial_ends_at: 1.minute.ago)

    expect(plan_for(user)).to have_attributes(plan: "ended", ai_access?: false)
  end

  it "treats a user with no trial date (never verified) as ended" do
    user.update_columns(trial_ends_at: nil)

    expect(plan_for(user).plan).to eq("ended")
  end

  %w[active past_due].each do |status|
    it "treats a #{status} subscription as paid, even after the trial ended" do
      user.update!(trial_ends_at: 1.day.ago)
      subscription = create(:billing_subscription, user: user, status: status, cancel_at_period_end: true)

      expect(plan_for(user.reload)).to have_attributes(plan: "paid", current_period_end: subscription.current_period_end,
        cancel_at_period_end: true, daily_spend_cap_microdollars: PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS, ai_access?: true)
    end
  end

  %w[unpaid canceled incomplete incomplete_expired].each do |status|
    it "does not treat a #{status} subscription as paid" do
      user.update!(trial_ends_at: 1.day.ago)
      create(:billing_subscription, user: user, status: status)

      expect(plan_for(user.reload).plan).to eq("ended")
    end
  end

  it "keeps showing the trial end date after upgrading" do
    create(:billing_subscription, user: user)

    expect(plan_for(user.reload)).to have_attributes(plan: "paid", trial_ends_at: user.trial_ends_at)
  end

  describe "operator override" do
    it "wins over the plan's cap" do
      user.update!(daily_ai_spend_cap_microdollars: 42)

      expect(plan_for(user).daily_spend_cap_microdollars).to eq(42)
    end

    it "grants AI access even when the plan ended" do
      user.update!(trial_ends_at: 1.day.ago, daily_ai_spend_cap_microdollars: 42)

      expect(plan_for(user)).to have_attributes(plan: "ended", daily_spend_cap_microdollars: 42, ai_access?: true)
    end
  end
end
