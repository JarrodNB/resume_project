# Shallow queries can still ask for excessive work by repeating nested collections.
# Check the schema's complexity boundary and rejection before any resolver runs.
require "rails_helper"

RSpec.describe "GraphQL query complexity" do
  let(:user) { create(:user) }

  # Each aliased selection costs four: jobs, id, gapResponses, and its id.
  def collection_query(count)
    selections = count.times.map do |index|
      "jobs#{index}: jobs { id gapResponses { id } }"
    end
    "query { #{selections.join(' ')} }"
  end

  it "accepts a query at the complexity limit" do
    result = execute_graphql(collection_query(75), user: user)

    expect(result["errors"]).to be_nil
    expect(result.fetch("data")).to eq(75.times.to_h { |index| [ "jobs#{index}", [] ] })
  end

  it "rejects an over-limit query before resolving collections" do
    expect(user).not_to receive(:jobs)

    result = execute_graphql(collection_query(76), user: user)

    expect(result).not_to have_key("data")
    expect(result.fetch("errors")).to contain_exactly(
      include("message" => "Query has complexity of 304, which exceeds max complexity of 300")
    )
  end
end
