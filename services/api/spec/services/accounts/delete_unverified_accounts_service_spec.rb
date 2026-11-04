# Removes only accounts that stayed unverified for a week, including after a recheck under lock.
require "rails_helper"

RSpec.describe Accounts::DeleteUnverifiedAccountsService do
  # Devise stamps confirmation_sent_at on create, so backdate it afterward.
  def unverified(created_at:, confirmation_sent_at: created_at)
    create(:user, confirmed_at: nil).tap { |user| user.update_columns(created_at:, confirmation_sent_at:) }
  end

  it "deletes accounts unverified for over a week and reports how many it examined" do
    stale = unverified(created_at: 8.days.ago)

    expect(described_class.call.value).to eq(1)
    expect(User.exists?(stale.id)).to be(false)
  end

  it "keeps accounts younger than a week" do
    recent = unverified(created_at: 6.days.ago)
    described_class.call
    expect(User.exists?(recent.id)).to be(true)
  end

  it "keeps verified accounts, however old" do
    verified = create(:user, created_at: 1.year.ago, confirmed_at: 1.year.ago)
    described_class.call
    expect(User.exists?(verified.id)).to be(true)
  end

  it "keeps an old account that asked for a new email this week" do
    resent = unverified(created_at: 30.days.ago, confirmation_sent_at: 1.day.ago)
    described_class.call
    expect(User.exists?(resent.id)).to be(true)
  end

  it "keeps an account verified after it was selected" do
    account = unverified(created_at: 8.days.ago)
    allow_any_instance_of(User).to receive(:with_lock).and_wrap_original do |original, &block|
      User.where(id: account.id).update_all(confirmed_at: Time.current)
      original.call(&block)
    end

    expect(described_class.call.value).to eq(1)

    expect(User.exists?(account.id)).to be(true)
  end

  it "runs again from the job only when a batch was full" do
    stub_const("#{described_class}::BATCH_SIZE", 1)
    2.times { unverified(created_at: 8.days.ago) }

    expect { Accounts::DeleteUnverifiedAccountsJob.perform_now }.to have_enqueued_job(Accounts::DeleteUnverifiedAccountsJob)
    expect(User.count).to eq(1)
    expect { Accounts::DeleteUnverifiedAccountsJob.perform_now }.to have_enqueued_job(Accounts::DeleteUnverifiedAccountsJob)
    expect { Accounts::DeleteUnverifiedAccountsJob.perform_now }.not_to have_enqueued_job
    expect(User.count).to eq(0)
  end
end
