# Description: Billing::Trial is the one place that knows how long the free trial is and when it ends.
require "rails_helper"

RSpec.describe Billing::Trial do
  let(:confirmed_at) { Time.utc(2026, 11, 21, 12) }

  it "is seven days long" do
    expect(described_class::LENGTH).to eq(7.days)
  end

  describe ".start!" do
    it "stores the end of the trial one trial length after the given time" do
      user = create(:user, trial_ends_at: nil)

      described_class.start!(user, at: confirmed_at)

      expect(user.reload.trial_ends_at).to eq(confirmed_at + 7.days)
    end
  end

  describe ".ends_at_for" do
    it "uses the stored trial end when there is one" do
      user = build(:user, confirmed_at: confirmed_at, trial_ends_at: confirmed_at + 2.days)

      expect(described_class.ends_at_for(user)).to eq(confirmed_at + 2.days)
    end

    it "falls back to one trial length after confirmation when no trial end is stored" do
      user = build(:user, confirmed_at: confirmed_at, trial_ends_at: nil)

      expect(described_class.ends_at_for(user)).to eq(confirmed_at + 7.days)
    end

    it "is nil for a user who never confirmed and has no stored trial end" do
      user = build(:user, confirmed_at: nil, trial_ends_at: nil)

      expect(described_class.ends_at_for(user)).to be_nil
    end
  end
end
