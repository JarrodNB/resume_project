# A user is comped when an operator gave them their own daily AI spend cap.
require "rails_helper"

RSpec.describe User, "comped" do
  let!(:comped_user) { create(:user, daily_ai_spend_cap_microdollars: 1_000_000) }
  let!(:regular_user) { create(:user) }

  it "is true only when an operator cap is set" do
    expect(comped_user).to be_comped
    expect(regular_user).not_to be_comped
  end

  it "has scopes for each side" do
    expect(described_class.comped).to contain_exactly(comped_user)
    expect(described_class.not_comped).to contain_exactly(regular_user)
  end
end
