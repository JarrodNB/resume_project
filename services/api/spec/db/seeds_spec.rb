# Checks that browser QA accounts can be seeded repeatedly without changing saved
# accounts or sending mail, and that the public credentials stay development-only.
require "rails_helper"

RSpec.describe "Development account seeds" do
  subject(:seed_accounts) { load Rails.root.join("db/seeds.rb") }

  let(:emails) { %w[qa.primary@example.test qa.secondary@example.test] }

  before do
    allow(Rails.env).to receive(:development?).and_return(true)
  end

  it "creates two confirmed accounts that accept the documented password without sending mail" do
    expect { seed_accounts }.to change(User, :count).by(2)
      .and have_enqueued_job(ActionMailer::MailDeliveryJob).exactly(0).times

    accounts = User.where(email: emails)
    expect(accounts.map(&:name)).to contain_exactly("QA Primary", "QA Secondary")
    accounts.each do |user|
      expect(user).to be_confirmed
      expect(user.valid_password?("local cedar lantern harbor 2026")).to be(true)
    end
  end

  it "gives new accounts a long trial with the paid daily cap and no Stripe records" do
    seed_accounts

    User.where(email: emails).each do |user|
      expect(user.trial_ends_at).to be > 9.years.from_now
      expect(user.daily_ai_spend_cap_microdollars).to eq(PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS)
      expect(user.billing_subscription).to be_nil
    end
  end

  it "replaces a fake Stripe row from older seeds with the long trial" do
    user = create(:user, email: emails.first, trial_ends_at: 1.day.ago)
    create(:billing_subscription, user: user, stripe_customer_id: "cus_seed_1", stripe_subscription_id: "sub_seed_1")

    seed_accounts

    expect(user.reload.billing_subscription).to be_nil
    expect(user.trial_ends_at).to be > 9.years.from_now
  end

  it "preserves existing passwords, profiles, and saved work when rerun" do
    user = create(:user, email: emails.first, name: "Edited QA profile", password: "a quiet orchard after rain")
    job = create(:job, user: user)
    original_attributes = user.attributes

    seed_accounts
    expect { seed_accounts }.not_to change(User, :count)

    expect(user.reload.attributes).to eq(original_attributes)
    expect(user.jobs).to include(job)
    expect(user.valid_password?("a quiet orchard after rain")).to be(true)
  end

  it "does not create fixture accounts outside development" do
    allow(Rails.env).to receive(:development?).and_return(false)

    expect { seed_accounts }.not_to change(User, :count)
    expect(User.where(email: emails)).to be_empty
  end
end
