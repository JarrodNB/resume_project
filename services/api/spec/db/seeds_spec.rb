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
