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
    user.update_columns(trial_ends_at: nil, confirmed_at: nil)

    expect(plan_for(user).plan).to eq("ended")
  end

  describe "a confirmed user whose trial date was never filled in (confirmed during a deploy)" do
    it "gets the trial from seven days after confirming" do
      user.update_columns(trial_ends_at: nil, confirmed_at: 2.days.ago)

      expect(plan_for(user)).to have_attributes(plan: "trial", trial_ends_at: be_within(1.second).of(5.days.from_now), ai_access?: true)
    end

    it "is ended once those seven days have passed" do
      user.update_columns(trial_ends_at: nil, confirmed_at: 8.days.ago)

      expect(plan_for(user).plan).to eq("ended")
    end

    it "stays ended and has no trial date when never confirmed" do
      user.update_columns(trial_ends_at: nil, confirmed_at: nil)

      expect(plan_for(user)).to have_attributes(plan: "ended", trial_ends_at: nil)
    end
  end

  %w[active past_due].each do |status|
    it "treats a #{status} subscription as paid, even after the trial ended" do
      user.update!(trial_ends_at: 1.day.ago)
      subscription = create(:billing_subscription, user: user, status: status, cancel_at_period_end: true)

      expect(plan_for(user.reload)).to have_attributes(plan: "paid", current_period_end: subscription.current_period_end,
        cancel_at_period_end: true, daily_spend_cap_microdollars: PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS, ai_access?: true)
    end
  end

  { "past_due" => true, "active" => false }.each do |status, failed|
    it "says the payment #{failed ? "failed" : "is fine"} for a #{status} subscription" do
      create(:billing_subscription, user: user, status: status)

      expect(plan_for(user.reload).payment_failed).to eq(failed)
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

  describe "plan predicates" do
    it "says trial? only on the trial plan" do
      user.update!(trial_ends_at: 3.days.from_now)

      expect(plan_for(user)).to have_attributes(trial?: true, paid?: false, ended?: false)
    end

    it "says paid? only on the paid plan" do
      create(:billing_subscription, user: user)

      expect(plan_for(user.reload)).to have_attributes(trial?: false, paid?: true, ended?: false)
    end

    it "says ended? only on the ended plan" do
      user.update!(trial_ends_at: 1.day.ago)

      expect(plan_for(user)).to have_attributes(trial?: false, paid?: false, ended?: true)
    end
  end

  describe "operator cap override" do
    it "wins over the trial plan's cap" do
      user.update!(trial_ends_at: 3.days.from_now, daily_ai_spend_cap_microdollars: 42)

      expect(plan_for(user)).to have_attributes(plan: "trial", daily_spend_cap_microdollars: 42, ai_access?: true)
    end

    it "wins over the paid plan's cap" do
      create(:billing_subscription, user: user)
      user.update!(daily_ai_spend_cap_microdollars: 42)

      expect(plan_for(user.reload)).to have_attributes(plan: "paid", daily_spend_cap_microdollars: 42, ai_access?: true)
    end

    it "never grants AI access when the plan ended" do
      user.update!(trial_ends_at: 1.day.ago, daily_ai_spend_cap_microdollars: 42)

      expect(plan_for(user)).to have_attributes(plan: "ended", daily_spend_cap_microdollars: 42, ai_access?: false)
    end
  end
end
