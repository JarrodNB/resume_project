# Sign-up refuses a request that fails the bot check, before creating an account or sending mail.
require "rails_helper"

RSpec.describe "Sign-up bot check", type: :request do
  let(:credentials) { { email: "person@example.com", password: "a quiet orchard after rain" } }

  it "passes the browser token and client IP to the check" do
    post "/auth/sign_up", params: { user: credentials, turnstile_token: "browser-token" }, as: :json, headers: { "REMOTE_ADDR" => "8.8.8.8" }

    expect(response).to have_http_status(:accepted)
    expect(Accounts::VerifyBotChallengeService).to have_received(:call).with(token: "browser-token", client_ip: "8.8.8.8")
  end

  context "when the check fails" do
    before do
      allow(Accounts::VerifyBotChallengeService).to receive(:call)
        .and_return(ServiceResult.new(success: false, value: nil, errors: [ Accounts::VerifyBotChallengeService::FAILED ]))
    end

    it "creates no account and sends no email" do
      expect {
        expect { post "/auth/sign_up", params: { user: credentials }, as: :json }.not_to change(User, :count)
      }.not_to have_enqueued_job

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to eq([ Accounts::VerifyBotChallengeService::FAILED ])
    end

    it "gives the same answer for an existing email, so it reveals nothing" do
      create(:user, email: credentials[:email])
      post "/auth/sign_up", params: { user: credentials }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to eq([ Accounts::VerifyBotChallengeService::FAILED ])
    end
  end
end
