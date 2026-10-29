# Cable is only a subscription transport. Queries and mutations must go through
# the HTTP endpoint, where CSRF and request throttles are enforced.
require "rails_helper"

RSpec.describe GraphqlChannel, type: :channel do
  before do
    stub_connection current_user: double(id: "owner"), session_valid?: true, check_session: nil
    subscribe
  end

  [
    [ "{ __typename }", nil ],
    [ "mutation Write { __typename }", nil ],
    [ "subscription Watch { __typename } query Read { __typename }", "Read" ],
    [ "invalid graphql", nil ]
  ].each do |query, operation|
    it "rejects non-subscription operation #{operation || query}" do
      expect(ApiSchema).not_to receive(:execute)
      perform :execute, "query" => query, "operationName" => operation
      expect(transmissions.last).to include("more" => false)
      expect(transmissions.last.dig("result", "errors", 0, "message")).to eq("Cable accepts subscriptions only")
    end
  end

  it "passes the selected subscription to the schema" do
    query = "query Read { __typename } subscription Watch { aiTaskFinished { cursor } }"
    result = double(context: {}, to_h: { "data" => {} }, subscription?: true)
    expect(ApiSchema).to receive(:execute).with(query, hash_including(operation_name: "Watch")).and_return(result)
    perform :execute, "query" => query, "operationName" => "Watch"
    expect(transmissions.last["more"]).to be(true)
  end
end
