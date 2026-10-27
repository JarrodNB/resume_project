# Description: The committed graphql_schema/schema.graphql (used by the web app's codegen) matches the live schema.
require "rails_helper"

RSpec.describe "schema.graphql" do
  it "is up to date (run `bin/rails graphql:schema:dump` if this fails)" do
    expect(Rails.root.join("graphql_schema", "schema.graphql").read).to eq(ApiSchema.to_definition)
  end
end
