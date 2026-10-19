# Session-backed connections must stop operations and private delivery after revocation.
require "rails_helper"

RSpec.describe ApplicationCable::Connection, type: :channel do
  let(:user) { create(:user) }
  let(:session_id) { Rack::Session::SessionId.new(SecureRandom.hex(32)) }
  let!(:record) do
    ActiveRecord::SessionStore::Session.create!(session_id: session_id.private_id,
      data: { "warden.user.user.key" => User.serialize_into_session(user), "authenticated_at" => Time.current.to_i })
  end

  def connect_session
    connect "/cable", session: { "session_id" => session_id.public_id }
  end

  it "connects using the persisted HTTP session" do
    connect_session
    expect(connection.current_user).to eq(user)
  end

  it "rejects missing sessions even with an old URL token" do
    expect { connect "/cable", params: { token: "legacy" } }.to have_rejected_connection
  end

  it "closes an open connection at the next heartbeat after logout" do
    connect_session
    record.destroy!
    expect(connection).to receive(:close).with(reason: "Session expired", reconnect: false)
    connection.beat
  end

  it "closes an open connection after absolute expiry" do
    connect_session
    travel 1.day + 1.second
    expect(connection).to receive(:close).with(reason: "Session expired", reconnect: false)
    connection.beat
  end
end
