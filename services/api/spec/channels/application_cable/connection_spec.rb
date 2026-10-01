# Description: WebSocket authentication with the JWT in the `token` query param.
require "rails_helper"

RSpec.describe ApplicationCable::Connection, type: :channel do
  let(:user) { create(:user) }
  let(:token_and_payload) { Warden::JWTAuth::UserEncoder.new.call(user, :user, nil) }

  it "connects with a valid token" do
    connect "/cable", params: { token: token_and_payload.first }

    expect(connection.current_user).to eq(user)
  end

  it "rejects a missing token" do
    expect { connect "/cable" }.to have_rejected_connection
  end

  it "rejects a malformed token" do
    expect { connect "/cable", params: { token: "not-a-jwt" } }.to have_rejected_connection
  end

  it "rejects a revoked (signed-out) token" do
    token, payload = token_and_payload
    JwtDenylist.create!(jti: payload["jti"], exp: Time.zone.at(payload["exp"]))

    expect { connect "/cable", params: { token: token } }.to have_rejected_connection
  end
end
