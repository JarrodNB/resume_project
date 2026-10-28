# Private subscription results must reach their owner without being copied into
# ActionCable debug logs, which otherwise inspect the first 300 payload characters.
require "rails_helper"

RSpec.describe GraphqlChannel, type: :channel do
  before do
    stub_connection current_user: double(id: "owner"), session_valid?: true, check_session: nil
    subscribe
  end

  it "delivers the complete result without logging its private contents" do
    output = StringIO.new
    logger = ActiveSupport::Logger.new(output)
    logger.level = Logger::DEBUG
    allow(subscription).to receive(:logger).and_return(logger)
    payload = { "result" => { "data" => { "interviewSessionUpdated" => { "transcript" => "private-candidate-answer" } } }, "more" => true }
    events = []
    listener = ->(*arguments) { events << arguments.last }
    ActiveSupport::Notifications.subscribed(listener, "transmit.action_cable") do
      subscription.transmit(payload, via: "subscription-update")
    end
    expect(transmissions.last).to eq(payload)
    expect(events.last).to include(data: payload, via: "subscription-update")
    expect(output.string).not_to include("private-candidate-answer", "interviewSessionUpdated")
  end

  it "still blocks private transmission after session revocation" do
    allow(connection).to receive(:session_valid?).and_return(false)
    expect(connection).to receive(:check_session)
    subscription.transmit({ result: { private: "must not arrive" } })
    expect(transmissions).to be_empty
  end
end
