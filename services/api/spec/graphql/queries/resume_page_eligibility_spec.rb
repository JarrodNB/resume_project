# The quick two-page offer check is scoped to the authenticated owner.
require "rails_helper"

RSpec.describe "Resume page eligibility", type: :request do
  it "uses the signed-in library without accepting another user id" do
    owner = create(:user, summary: "Led " * 700)
    other = create(:user)
    expect(execute_graphql("{ resumeTwoPageEligible }", user: owner).dig("data", "resumeTwoPageEligible")).to be(true)
    expect(execute_graphql("{ resumeTwoPageEligible }", user: other).dig("data", "resumeTwoPageEligible")).to be(false)
  end
end
