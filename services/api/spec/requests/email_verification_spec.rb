# Exercises real account creation, mail and one-use confirmation without signing in.
require "rails_helper"

RSpec.describe "Email verification", type: :request do
  include ActiveJob::TestHelper
  around { |example| perform_enqueued_jobs(only: AccountMailDeliveryJob) { example.run } }
  let(:credentials) { { email: "new@example.com", password: "a quiet orchard after rain", name: "Ada" } }

  it "creates an unconfirmed account, sends mail and requires verification before login" do
    expect { post "/auth/sign_up", params: { user: credentials }, as: :json }.to change(User, :count).by(1)
    expect(response).to have_http_status(:accepted)
    user = User.find_by!(email: credentials[:email])
    expect(user).not_to be_confirmed
    expect(ActionMailer::Base.deliveries.last.to).to eq([ user.email ])
    get "/auth/session"
    expect(response.parsed_body["user"]).to be_nil
    post "/auth/sign_in", params: { user: credentials }, as: :json
    expect(response).to have_http_status(:unauthorized)
    post "/auth/confirmation/verify", params: { confirmation_token: user.confirmation_token }, as: :json
    expect(response).to have_http_status(:ok)
    expect(user.reload).to be_confirmed
    get "/auth/session"
    expect(response.parsed_body["user"]).to be_nil
  end

  it "uses generic signup and resend responses without changing an existing account" do
    user = create(:user, email: credentials[:email])
    before = user.attributes
    post "/auth/sign_up", params: { user: credentials.merge(password: "another quiet orchard after rain", name: "Replacement") }, as: :json
    expect(response).to have_http_status(:accepted)
    generic = response.parsed_body
    expect(user.reload.attributes).to eq(before)
    [ user.email, "unknown@example.com" ].each do |email|
      post "/auth/confirmation", params: { user: { email: email } }, as: :json
      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body).to eq(generic)
    end
  end

  it "rejects expired, reused, malformed and superseded tokens" do
    post "/auth/sign_up", params: { user: credentials }, as: :json
    user = User.find_by!(email: credentials[:email])
    first = user.confirmation_token
    post "/auth/confirmation", params: { user: { email: user.email } }, as: :json
    second = user.reload.confirmation_token
    expect(second).not_to eq(first)
    [ nil, [], {}, "bad", first ].each do |token|
      post "/auth/confirmation/verify", params: { confirmation_token: token }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
    travel 24.hours + 1.second
    post "/auth/confirmation/verify", params: { confirmation_token: second }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    post "/auth/confirmation", params: { user: { email: user.email } }, as: :json
    current = user.reload.confirmation_token
    post "/auth/confirmation/verify", params: { confirmation_token: current }, as: :json
    expect(response).to have_http_status(:ok)
    post "/auth/confirmation/verify", params: { confirmation_token: current }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "does not expose tokens or email addresses in debug mail logs and uses configured URLs" do
    old_url = ENV["WEB_APP_URL"]
    ENV["WEB_APP_URL"] = "https://app.example.com"
    output = StringIO.new
    logger = ActiveSupport::Logger.new(output)
    original = Rails.logger
    expect(ActionMailer::Base.logger).to be_nil
    Rails.logger = logger
    post "/auth/sign_up", params: { user: credentials }, as: :json, headers: { "HOST" => "hostile.example" }
    user = User.find_by!(email: credentials[:email])
    mail = ActionMailer::Base.deliveries.last
    expect(mail.body.decoded).to include("https://app.example.com/verify-email#confirmation_token=#{user.confirmation_token}")
    expect(mail.body.decoded).not_to include("hostile.example")
    expect(output.string).not_to include(user.confirmation_token, user.email)
  ensure
    ENV["WEB_APP_URL"] = old_url
    Rails.logger = original
  end

  it "returns safe validation errors for malformed emails" do
    [ 123, true, "invalid\0@example.com" ].each do |email|
      post "/auth/sign_up", params: { user: credentials.merge(email: email) }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  it "rejects malformed envelopes and fields without server errors" do
    [ {}, { user: "scalar" }, { user: [] } ].each do |body|
      post "/auth/sign_up", params: body, as: :json
      expect(response).to have_http_status(:bad_request)
      post "/auth/confirmation", params: body, as: :json
      expect(response).to have_http_status(:bad_request)
    end
    [ [], {}, true ].each do |name|
      post "/auth/sign_up", params: { user: credentials.merge(name: name) }, as: :json
      expect(response.status).to be_between(200, 499)
    end
    post "/auth/sign_up", params: { user: credentials.merge(password: "short") }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"].join).to include("Password")
  end

  it "keeps queue outages generic and allows a later resend" do
    adapter = AccountMailDeliveryJob.queue_adapter
    allow(adapter).to receive(:enqueue).and_raise(SolidQueue::Job::EnqueueError.new("private queue credentials"))
    output = StringIO.new
    original = ActiveJob::Base.logger
    ActiveJob::Base.logger = ActiveSupport::Logger.new(output)
    post "/auth/sign_up", params: { user: credentials }, as: :json
    expect(response).to have_http_status(:accepted)
    expect(output.string).to include("Account email enqueue failed")
    expect(output.string).not_to include("private queue credentials", credentials[:email])
    user = User.find_by!(email: credentials[:email])
    expect(user).not_to be_confirmed
    allow(adapter).to receive(:enqueue).and_call_original
    post "/auth/confirmation", params: { user: { email: user.email } }, as: :json
    expect(response).to have_http_status(:accepted)
    expect(ActionMailer::Base.deliveries.last.to).to eq([ user.email ])
  ensure
    ActiveJob::Base.logger = original
  end

  it "does not disclose unconfirmed accounts in login errors" do
    user = create(:user, confirmed_at: nil)
    bodies = [ [ user.email, "a quiet orchard after rain" ], [ user.email, "wrong" ], [ "unknown@example.com", "wrong" ] ].map do |email, password|
      post "/auth/sign_in", params: { user: { email: email, password: password } }, as: :json
      expect(response).to have_http_status(:unauthorized)
      response.parsed_body
    end
    expect(bodies.uniq.size).to eq(1)
  end

  it "keeps an existing signed-in identity when verifying another account" do
    existing = create(:user)
    post "/auth/sign_in", params: { user: { email: existing.email, password: "a quiet orchard after rain" } }, as: :json
    post "/auth/sign_up", params: { user: credentials }, as: :json
    other = User.find_by!(email: credentials[:email])
    post "/auth/confirmation/verify", params: { confirmation_token: other.confirmation_token }, as: :json
    expect(response).to have_http_status(:ok)
    get "/auth/session"
    expect(response.parsed_body.dig("user", "id")).to eq(existing.id)
  end

  it "requires CSRF on resend and verification, and never verifies through GET" do
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    post "/auth/confirmation", params: { user: { email: "unknown@example.com" } }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    post "/auth/confirmation/verify", params: { confirmation_token: "invalid" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    get "/auth/confirmation/verify", params: { confirmation_token: "invalid" }
    expect(response).to have_http_status(:not_found)
    get "/auth/session"
    csrf = response.parsed_body.fetch("csrfToken")
    post "/auth/confirmation", params: { user: { email: "unknown@example.com" } }, as: :json, headers: { "X-CSRF-Token" => csrf }
    expect(response).to have_http_status(:accepted)
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  it "rejects an existing serialized session if its account is unconfirmed" do
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }, as: :json
    expect(response).to have_http_status(:ok)
    user.update_columns(confirmed_at: nil)
    post "/graphql", params: { query: "{ me { email } }" }, as: :json
    expect(response).to have_http_status(:unauthorized)
    get "/auth/session"
    expect(response.parsed_body["user"]).to be_nil
  end
end
