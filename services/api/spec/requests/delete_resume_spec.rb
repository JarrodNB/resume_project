# Resume deletion requires the same authenticated HTTP session as other domain writes.
require "rails_helper"

RSpec.describe "Resume deletion authentication", type: :request do
  it "rejects deletion without a token and preserves the resume" do
    resume = create(:resume)

    post "/graphql",
         params: { query: "mutation { deleteResume(input: { id: \"#{resume.id}\" }) { errors } }" }.to_json,
         headers: { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json" }

    expect(response).to have_http_status(:unauthorized)
    expect(resume.reload).to be_persisted
  end
end
