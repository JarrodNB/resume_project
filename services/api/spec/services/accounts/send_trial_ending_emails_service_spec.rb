require "rails_helper"

RSpec.describe Accounts::SendTrialEndingEmailsService do
  include ActiveJob::TestHelper

  def trial_ending_mails
    enqueued_jobs.select { |job| job[:job] == AccountMailDeliveryJob && job[:args].include?("trial_ending") }
  end

  before { clear_enqueued_jobs }

  it "emails an unpaid trial user whose trial ends within the window and marks them sent" do
    user = create(:user, trial_ends_at: 20.hours.from_now)

    result = described_class.call

    expect(result).to be_success
    expect(trial_ending_mails.size).to eq(1)
    expect(user.reload.trial_ending_email_sent_at).to be_within(1.minute).of(Time.current)
  end

  it "sends only once when run twice" do
    create(:user, trial_ends_at: 20.hours.from_now)

    2.times { described_class.call }

    expect(trial_ending_mails.size).to eq(1)
  end

  it "only lets one run claim a user" do
    user = create(:user, trial_ends_at: 20.hours.from_now)
    service = described_class.new

    expect(service.send(:claim, user)).to be(true)
    expect(service.send(:claim, user)).to be(false)
  end

  it "covers a trial ending 35 hours away so a daily run never skips anyone" do
    create(:user, trial_ends_at: 35.hours.from_now)
    described_class.call
    expect(trial_ending_mails.size).to eq(1)
  end

  it "skips users whose trial is further away, already over, or never set" do
    create(:user, trial_ends_at: 3.days.from_now)
    create(:user, trial_ends_at: 1.hour.ago)
    create(:user, trial_ends_at: nil)
    described_class.call
    expect(trial_ending_mails).to be_empty
  end

  it "skips unconfirmed users" do
    create(:user, confirmed_at: nil, trial_ends_at: 20.hours.from_now)
    described_class.call
    expect(trial_ending_mails).to be_empty
  end

  it "skips paid users but not users whose subscription is canceled" do
    paid = create(:user, trial_ends_at: 20.hours.from_now)
    create(:billing_subscription, user: paid, status: "active")
    canceled = create(:user, trial_ends_at: 20.hours.from_now)
    create(:billing_subscription, user: canceled, status: "canceled")

    described_class.call

    expect(trial_ending_mails.size).to eq(1)
    expect(paid.reload.trial_ending_email_sent_at).to be_nil
    expect(canceled.reload.trial_ending_email_sent_at).to be_present
  end

  it "still emails a user with a spend-cap override, since the override does not extend the trial" do
    create(:user, trial_ends_at: 20.hours.from_now, daily_ai_spend_cap_microdollars: 1_000_000)
    described_class.call
    expect(trial_ending_mails.size).to eq(1)
  end

  it "releases the claim when the email cannot be queued so a later run retries" do
    user = create(:user, trial_ends_at: 20.hours.from_now)
    allow(AccountMailer).to receive(:trial_ending).and_raise(ActiveJob::EnqueueError)

    expect { described_class.call }.to raise_error(ActiveJob::EnqueueError)

    expect(user.reload.trial_ending_email_sent_at).to be_nil
  end
end
