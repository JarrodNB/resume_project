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
    stub_connection current_user: as_user
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
end
