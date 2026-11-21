# The sync job runs the service for the given subscription id.
require "rails_helper"

RSpec.describe Billing::SyncSubscriptionJob do
  it "syncs the subscription named in the job" do
    user = create(:user)
    row = create(:billing_subscription, user: user, stripe_customer_id: "cus_1", stripe_subscription_id: nil, status: nil)
    FakeStripeGateway.subscriptions["sub_1"] = Billing::Gateway::Subscription.new(id: "sub_1", customer_id: "cus_1", status: "active",
      current_period_end: 30.days.from_now, cancel_at_period_end: false, user_id: user.id)

    described_class.perform_now("sub_1")

    expect(row.reload.status).to eq("active")
  end

  it "retries when the payment provider is unavailable" do
    allow(Billing::SyncSubscriptionService).to receive(:call).and_raise(Billing::Gateway::Unavailable, "down")

    expect { described_class.perform_now("sub_1") }.to have_enqueued_job(described_class).with("sub_1")
  end

  # Stripe has already had its 200, so a lost sync is never redelivered. polynomially_longer waits
  # n**4 + 2 seconds after attempt n; 16 attempts add up to about 2 days.
  describe "retry window" do
    before { allow(Billing::SyncSubscriptionService).to receive(:call).and_raise(Billing::Gateway::Unavailable, "down") }

    def perform_as_attempt(number)
      job = described_class.new("sub_1")
      job.exception_executions = { [ Billing::Gateway::Unavailable ].to_s => number - 1 }
      job.perform_now
    end

    it "still retries after the fifteenth failed attempt" do
      expect { perform_as_attempt(15) }.to have_enqueued_job(described_class).with("sub_1")
    end

    it "gives up (raising) after the sixteenth failed attempt" do
      expect { perform_as_attempt(16) }.to raise_error(Billing::Gateway::Unavailable)
    end

    it "waits about two days in total across all retries" do
      seconds = (1..15).sum { |attempt| attempt**4 + 2 } # 15 waits between 16 attempts, no jitter

      expect(seconds).to be_between(2.days - 3.hours, 2.days + 3.hours)
    end
  end

  it "drops the job without retrying when Stripe no longer has the subscription" do
    allow(Billing::SyncSubscriptionService).to receive(:call).and_raise(Billing::Gateway::NotFound, "No such subscription")
    allow(Rails.logger).to receive(:warn)

    expect { described_class.perform_now("sub_gone") }.not_to have_enqueued_job(described_class)
    expect(Rails.logger).to have_received(:warn).with(/sub_gone/)
  end

  it "uses an existing queue" do
    expect(described_class.new.queue_name).to eq("default")
  end
end
