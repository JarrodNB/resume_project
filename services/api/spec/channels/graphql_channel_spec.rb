# Description: Running the aiTaskUpdated subscription over the GraphQL channel, with ownership checks.
require "rails_helper"

RSpec.describe GraphqlChannel, type: :channel do
  let(:user) { create(:user) }
  let(:ai_task) { create(:ai_task, user: user) }
  let(:subscription_query) do
    <<~GRAPHQL
      subscription($id: ID!) { aiTaskUpdated(id: $id) { id status } }
    GRAPHQL
  end

  # Subscribes to the channel as `as_user` and runs the aiTaskUpdated subscription.
  def subscribe_to_ai_task(as_user:)
    stub_connection current_user: as_user, session_valid?: true, check_session: nil
    subscribe
    perform :execute, "query" => subscription_query, "variables" => { "id" => ai_task.id }
    transmissions.last
  end

  it "returns the task's current state and keeps the subscription open for its owner" do
    transmission = subscribe_to_ai_task(as_user: user)

    expect(transmission["more"]).to be(true)
    expect(transmission["result"]["data"]["aiTaskUpdated"]).to eq("id" => ai_task.id, "status" => "QUEUED")
  end

  it "doesn't let another user subscribe to the task" do
    transmission = subscribe_to_ai_task(as_user: create(:user))

    expect(transmission["result"]["errors"].first["message"]).to eq("Record not found")
    expect(transmission["result"]["data"]).to be_nil
  end

  it "blocks private delivery and new operations when an open session is revoked" do
    session_id = Rack::Session::SessionId.new(SecureRandom.hex(32))
    record = ActiveRecord::SessionStore::Session.create!(session_id: session_id.private_id,
      data: { "warden.user.user.key" => User.serialize_into_session(user), "authenticated_at" => Time.current.to_i })
    subscribe_to_ai_task(as_user: user)
    allow(connection).to receive(:session_valid?) do
      BrowserSessions::ResolveSessionIdentityService.call(session_id: session_id).success?
    end
    allow(connection).to receive(:check_session)
    record.destroy!
    previous = transmissions.size
    subscription.transmit({ result: { data: { private: "must not arrive" } } })
    expect(ApiSchema).not_to receive(:execute)
    perform :execute, "query" => "{ me { email } }"
    expect(transmissions.size).to eq(previous)
    expect(connection).to have_received(:check_session).twice
  end

  [ :reset, :change ].each do |operation|
    it "blocks private transmissions immediately after password #{operation}" do
      session_id = Rack::Session::SessionId.new(SecureRandom.hex(32))
      ActiveRecord::SessionStore::Session.create!(session_id: session_id.private_id,
        data: { "warden.user.user.key" => User.serialize_into_session(user), "authenticated_at" => Time.current.to_i })
      subscribe_to_ai_task(as_user: user)
      allow(connection).to receive(:session_valid?) { BrowserSessions::ResolveSessionIdentityService.call(session_id: session_id).success? }
      replacement = "another orchard after gentle rain"
      result = if operation == :reset
        Accounts::ResetPasswordService.call(token: user.send_reset_password_instructions, password: replacement, password_confirmation: replacement)
      else
        Accounts::ChangePasswordService.call(user: user, current_password: "a quiet orchard after rain", password: replacement, password_confirmation: replacement)
      end
      expect(result).to be_success
      previous = transmissions.size
      subscription.transmit({ result: { data: { private: "must not arrive" } } })
      expect(ApiSchema).not_to receive(:execute)
      perform :execute, "query" => "{ me { email } }"
      expect(transmissions.size).to eq(previous)
    end
  end
end
