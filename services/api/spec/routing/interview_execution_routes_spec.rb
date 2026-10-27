# Work starts through durable commands; the AI process cannot discover or clean up globally.
require "rails_helper"

RSpec.describe "Interview execution routes", type: :routing do
  it "removes global discovery and cleanup endpoints while retaining scoped callbacks" do
    expect(get: "/internal/interviews/operations").not_to be_routable
    expect(post: "/internal/interviews/cleanup").not_to be_routable
    expect(post: "/internal/interviews/operations/operation-id/claim").to route_to("internal/interviews#claim", id: "operation-id")
  end
end
