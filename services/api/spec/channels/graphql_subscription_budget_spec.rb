# One socket must not retain unlimited GraphQL registrations, even by opening
# several channel identifiers. Failures and cleanup must release only their slots.
require "rails_helper"

RSpec.describe GraphqlChannel, type: :channel do
  before do
    stub_connection current_user: double(id: "owner"), session_valid?: true, check_session: nil
    subscribe
  end

  let(:query) { "subscription { aiTaskFinished { cursor } }" }

  it "stops schema execution once one connection reaches its active limit" do
    calls = 0
    allow(ApiSchema).to receive(:execute) do
      calls += 1
      double(context: { subscription_id: "subscription-#{calls}" }, to_h: { data: {} }, subscription?: true)
    end
    50.times { perform :execute, "query" => query }
    other = described_class.new(connection, "secondary", {})
    other.subscribe_to_channel
    other.execute("query" => query)
    expect(calls).to eq(50)
    expect(connection.transmissions.last.dig("message", :result, :errors, 0, :message)).to eq("Too many active subscriptions")
  end

  it "releases rejected operations and schema exceptions" do
    allow(ApiSchema).to receive(:execute).and_raise(ArgumentError, "synthetic failure")
    55.times do
      expect { perform :execute, "query" => query }.to raise_error(ArgumentError, "synthetic failure")
    end
    expect(ApiSchema).to have_received(:execute).exactly(55).times
  end

  it "does not retain slots for validation failures" do
    result = double(context: {}, to_h: { errors: [ { message: "Invalid subscription" } ] }, subscription?: false)
    allow(ApiSchema).to receive(:execute).and_return(result)
    55.times { perform :execute, "query" => query }
    expect(ApiSchema).to have_received(:execute).exactly(55).times
  end

  it "reserves slots atomically under concurrent execution" do
    budget = ApplicationCable::SubscriptionBudget.new
    reservations = 100.times.map { Thread.new { budget.acquire } }.map(&:value).compact
    expect(reservations.size).to eq(50)
    reservations.each { |token| budget.release(token) }
    expect(budget.acquire).not_to be_nil
  end

  it "releases slots on cleanup without double-releasing another channel's slot" do
    budget = ApplicationCable::SubscriptionBudget.for_connection(connection)
    allow(ApiSchema).to receive(:execute).and_return(double(context: { subscription_id: "saved" }, to_h: { data: {} }, subscription?: true))
    allow(ApiSchema.subscriptions).to receive(:delete_subscription)
    perform :execute, "query" => query
    remaining = Array.new(49) { budget.acquire }
    expect(remaining).not_to include(nil)
    expect(budget.acquire).to be_nil
    subscription.unsubscribed
    replacement = budget.acquire
    expect(replacement).not_to be_nil
    subscription.unsubscribed
    expect(budget.acquire).to be_nil
    expect(ApiSchema.subscriptions).to have_received(:delete_subscription).with("saved").once
  end
end
