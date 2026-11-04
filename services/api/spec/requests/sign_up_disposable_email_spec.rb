# Sign-up refuses throwaway email domains with a clear message that reveals nothing about accounts.
require "rails_helper"

RSpec.describe "Sign-up with a disposable email", type: :request do
  def sign_up(email)
    post "/auth/sign_up", params: { user: { email: email, password: "a quiet orchard after rain" }, turnstile_token: "token" }, as: :json
  end

  [ "someone@mailinator.com", "SOMEONE@Mailinator.COM", "someone@inbox.mailinator.com", "someone@mailinator.com." ].each do |email|
    it "refuses #{email} without an account or email" do
      expect {
        expect { sign_up(email) }.not_to change(User, :count)
      }.not_to have_enqueued_job

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to eq([ Accounts::RegisterAccountService::DISPOSABLE_EMAIL ])
    end
  end

  it "gives an existing account on that domain the same answer" do
    create(:user, email: "taken@mailinator.com")
    sign_up("taken@mailinator.com")

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq([ Accounts::RegisterAccountService::DISPOSABLE_EMAIL ])
  end

  it "does not refuse a domain that only looks similar" do
    sign_up("someone@notmailinator.com")

    expect(response).to have_http_status(:accepted)
  end

  it "runs the bot check first" do
    allow(Accounts::VerifyBotChallengeService).to receive(:call)
      .and_return(ServiceResult.new(success: false, value: nil, errors: [ Accounts::VerifyBotChallengeService::FAILED ]))
    sign_up("someone@mailinator.com")

    expect(response.parsed_body["errors"]).to eq([ Accounts::VerifyBotChallengeService::FAILED ])
  end
end
