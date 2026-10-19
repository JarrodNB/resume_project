# Exercises account recovery through the real Devise token, mail and password boundaries.
require "rails_helper"

RSpec.describe "Password recovery", type: :request do
  include ActiveJob::TestHelper
  let(:original_password) { "a quiet orchard after rain" }
  let(:replacement) { "another orchard after gentle rain" }
  before { get "/auth/session" }

  it "changes only the signed-in account with its current password, then signs out" do
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: original_password } }, as: :json
    expect(response).to have_http_status(:ok)
    patch "/auth/password/change", params: { user: { current_password: original_password, password: replacement, password_confirmation: replacement, email: "attacker@example.com" } }, as: :json
    expect(response).to have_http_status(:ok)
    expect(user.reload.valid_password?(replacement)).to be(true)
    expect(user.email).not_to eq("attacker@example.com")
    get "/auth/session"
    expect(response.parsed_body["user"]).to be_nil
  end

  it "resets once, preserving state on invalid passwords and revoking two browsers" do
    user = create(:user)
    browsers = 2.times.map do
      browser = ActionDispatch::Integration::Session.new(Rails.application)
      browser.post "/auth/sign_in", params: { user: { email: user.email, password: original_password } }, as: :json
      expect(browser.response).to have_http_status(:ok)
      browser
    end
    token = user.send_reset_password_instructions
    original = user.reload.attributes
    put "/auth/password", params: { user: { reset_password_token: token, password: "short", password_confirmation: "short" } }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    expect(user.reload.attributes).to eq(original)
    put "/auth/password", params: { user: { reset_password_token: token, password: replacement, password_confirmation: replacement } }, as: :json
    expect(response).to have_http_status(:ok)
    expect(user.reload.valid_password?(replacement)).to be(true)
    expect(user.reset_password_token).to be_nil
    browsers.each do |browser|
      browser.get "/auth/session"
      expect(browser.response.parsed_body["user"]).to be_nil
    end
    put "/auth/password", params: { user: { reset_password_token: token, password: original_password, password_confirmation: original_password } }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "requests a generic recovery email without changing credentials or signing in" do
    user = create(:user)
    original = user.encrypted_password
    perform_enqueued_jobs(only: AccountMailDeliveryJob) do
      post "/auth/password", params: { user: { email: user.email } }, as: :json
    end
    expect(response).to have_http_status(:accepted)
    generic = response.parsed_body
    expect(ActionMailer::Base.deliveries.last.to).to eq([ user.email ])
    expect(user.reload.encrypted_password).to eq(original)
    post "/auth/password", params: { user: { email: "unknown@example.com" } }, as: :json
    expect(response).to have_http_status(:accepted)
    expect(response.parsed_body).to eq(generic)
    get "/auth/session"
    expect(response.parsed_body["user"]).to be_nil
  end
end

RSpec.describe "Password recovery security", type: :request do
  include ActiveJob::TestHelper
  before { get "/auth/session" }
  let(:replacement) { "another orchard after gentle rain" }

  def reset_with(token, password: replacement, confirmation: replacement)
    put "/auth/password", params: { user: { reset_password_token: token, password: password, password_confirmation: confirmation } }, as: :json
  end

  it "rejects expired, malformed and superseded tokens without touching credentials" do
    user = create(:user)
    first = user.send_reset_password_instructions
    second = user.reload.send_reset_password_instructions
    original = user.reload.attributes
    [ nil, {}, [], true, "bad", first ].each do |token|
      reset_with(token)
      expect(response).to have_http_status(:unprocessable_content)
      expect(user.reload.attributes).to eq(original)
    end
    travel 6.hours + 1.second
    reset_with(second)
    expect(response).to have_http_status(:unprocessable_content)
    expect(user.reload.attributes).to eq(original)
  end

  it "preserves a usable token and every session for invalid new passwords" do
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }, as: :json
    token = user.send_reset_password_instructions
    original = user.reload.attributes
    [ [ replacement, "different" ], [ replacement, nil ], [ "", "" ], [ "short", "short" ], [ "a" * 73, "a" * 73 ], [ "界" * 25, "界" * 25 ], [ "d41d8cd98f00b204e9800998ecf8427e", "d41d8cd98f00b204e9800998ecf8427e" ], [ "bad\0passwordlong", "bad\0passwordlong" ], [ [], [] ], [ true, true ] ].each do |password, confirmation|
      reset_with(token, password: password, confirmation: confirmation)
      expect(response).to have_http_status(:unprocessable_content)
      expect(user.reload.attributes).to eq(original)
      get "/auth/session"
      expect(response.parsed_body.dig("user", "id")).to eq(user.id)
    end
    reset_with(token)
    expect(response).to have_http_status(:ok)
  end

  it "never confirms accounts or recovers an unverified account" do
    user = create(:user, confirmed_at: nil)
    perform_enqueued_jobs(only: AccountMailDeliveryJob) do
      expect { post "/auth/password", params: { user: { email: user.email } }, as: :json }
        .not_to change(ActionMailer::Base.deliveries, :size)
    end
    expect(response).to have_http_status(:accepted)
    token = user.send_reset_password_instructions # Even a token issued outside this endpoint cannot bypass confirmation.
    original = user.reload.attributes
    reset_with(token)
    expect(response).to have_http_status(:unprocessable_content)
    expect(user.reload.attributes).to eq(original)
    expect(user).not_to be_confirmed
  end

  it "keeps unrelated signed-in identities on failed and successful public recovery" do
    signed_in, recovered = create_list(:user, 2)
    post "/auth/sign_in", params: { user: { email: signed_in.email, password: "a quiet orchard after rain" } }, as: :json
    token = recovered.send_reset_password_instructions
    reset_with("invalid")
    expect(response).to have_http_status(:unprocessable_content)
    reset_with(token)
    expect(response).to have_http_status(:ok)
    get "/auth/session"
    expect(response.parsed_body.dig("user", "id")).to eq(signed_in.id)
  end

  it "verifies current credentials and cannot update another account or identity fields" do
    user, other = create_list(:user, 2)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }, as: :json
    token = user.send_reset_password_instructions
    original = user.reload.attributes
    [ "wrong", nil, [], "bad\0password" ].each do |current|
      patch "/auth/password/change", params: { user: { current_password: current, password: replacement, password_confirmation: replacement, id: other.id, name: "Changed", email: other.email } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(user.reload.attributes).to eq(original)
      get "/auth/session"
      expect(response.parsed_body.dig("user", "id")).to eq(user.id)
    end
    patch "/auth/password/change", params: { user: { current_password: "a quiet orchard after rain", password: replacement, password_confirmation: replacement, id: other.id, email: other.email, name: "Changed" } }, as: :json
    expect(response).to have_http_status(:ok)
    expect(user.reload.name).to eq(original["name"])
    expect(user.email).to eq(original["email"])
    expect(other.reload.valid_password?("a quiet orchard after rain")).to be(true)
    reset_with(token)
    expect(response).to have_http_status(:unprocessable_content)
    patch "/auth/password/change", params: { user: { current_password: replacement, password: replacement, password_confirmation: replacement } }, as: :json
    expect(response).to have_http_status(:unauthorized)
  end

  it "keeps queue failures generic and lets the account request a fresh email" do
    user = create(:user)
    adapter = AccountMailDeliveryJob.queue_adapter
    allow(adapter).to receive(:enqueue).and_raise(SolidQueue::Job::EnqueueError.new("private provider secret"))
    post "/auth/password", params: { user: { email: user.email } }, as: :json
    expect(response).to have_http_status(:accepted)
    first = user.reload.reset_password_token
    expect(user.valid_password?("a quiet orchard after rain")).to be(true)
    allow(adapter).to receive(:enqueue).and_call_original
    perform_enqueued_jobs(only: AccountMailDeliveryJob) { post "/auth/password", params: { user: { email: user.email } }, as: :json }
    expect(response).to have_http_status(:accepted)
    expect(user.reload.reset_password_token).not_to eq(first)
    expect(ActionMailer::Base.deliveries.last.to).to eq([ user.email ])
  end

  it "preserves the signed-in session and a usable recovery token when a change fails policy" do
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }, as: :json
    token = user.send_reset_password_instructions
    original = user.reload.attributes
    [ [ "short", "short" ], [ replacement, "mismatch" ], [ "界" * 25, "界" * 25 ], [ "d41d8cd98f00b204e9800998ecf8427e", "d41d8cd98f00b204e9800998ecf8427e" ] ].each do |password, confirmation|
      patch "/auth/password/change", params: { user: { current_password: "a quiet orchard after rain", password: password, password_confirmation: confirmation } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(user.reload.attributes).to eq(original)
      get "/auth/session"
      expect(response.parsed_body.dig("user", "id")).to eq(user.id)
    end
    reset_with(token)
    expect(response).to have_http_status(:ok)
  end

  it "rejects malformed envelopes and requires CSRF for every password write" do
    [ {}, { user: [] }, { user: "scalar" } ].each do |body|
      post "/auth/password", params: body, as: :json
      expect(response).to have_http_status(:bad_request)
      put "/auth/password", params: body, as: :json
      expect(response).to have_http_status(:bad_request)
    end
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    post "/auth/password", params: { user: { email: "unknown@example.com" } }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    put "/auth/password", params: { user: { reset_password_token: "invalid" } }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    patch "/auth/password/change", params: { user: { current_password: "invalid" } }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    get "/auth/session"
    post "/auth/password", params: { user: { email: "unknown@example.com" } }, as: :json, headers: { "X-CSRF-Token" => response.parsed_body.fetch("csrfToken") }
    expect(response).to have_http_status(:accepted)
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end
end

RSpec.describe "Password session revocation", type: :request do
  before { get "/auth/session" }

  [ :reset, :change ].each do |operation|
    it "rejects captured cookie replay from every browser after #{operation}" do
      user = create(:user)
      browsers = 2.times.map do
        browser = ActionDispatch::Integration::Session.new(Rails.application)
        browser.get "/auth/session"
        browser.post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }, as: :json
        expect(browser.response).to have_http_status(:ok)
        [ browser, browser.response.headers.fetch("Set-Cookie").split(";").first ]
      end
      replacement = "another orchard after gentle rain"
      if operation == :reset
        token = user.send_reset_password_instructions
        put "/auth/password", params: { user: { reset_password_token: token, password: replacement, password_confirmation: replacement } }, as: :json
      else
        browsers.first.first.patch "/auth/password/change", params: { user: { current_password: "a quiet orchard after rain", password: replacement, password_confirmation: replacement } }, as: :json
        expect(browsers.first.first.response).to have_http_status(:ok)
      end
      browsers.each do |browser, cookie|
        browser.get "/auth/session"
        expect(browser.response.parsed_body["user"]).to be_nil
        replay = ActionDispatch::Integration::Session.new(Rails.application)
        replay.post "/graphql", params: { query: "{ me { email } }" }, as: :json, headers: { "HTTP_COOKIE" => cookie }
        expect(replay.response).to have_http_status(:unauthorized)
      end
    end
  end
end

RSpec.describe "Recovery email privacy", type: :request do
  include ActiveJob::TestHelper

  it "uses the trusted web fragment link and omits secrets from request, mail and job logs" do
    get "/auth/session"
    user = create(:user)
    old_url = ENV["WEB_APP_URL"]
    ENV["WEB_APP_URL"] = "https://app.example.com"
    output = StringIO.new
    logger = ActiveSupport::Logger.new(output, level: Logger::DEBUG)
    old_logger, old_job = Rails.logger, ActiveJob::Base.logger
    Rails.logger = logger
    ActiveJob::Base.logger = logger
    perform_enqueued_jobs(only: AccountMailDeliveryJob) do
      post "/auth/password", params: { user: { email: user.email } }, as: :json, headers: { "HOST" => "hostile.example" }
    end
    expect(response).to have_http_status(:accepted)
    body = ActionMailer::Base.deliveries.last.body.decoded
    raw = body.match(/reset_password_token=([A-Za-z0-9_-]+)/)[1]
    expect(body).to include("https://app.example.com/reset-password#reset_password_token=#{raw}")
    expect(body).not_to include("hostile.example")
    expect(user.reload.reset_password_token).to eq(Devise.token_generator.digest(User, :reset_password_token, raw))
    put "/auth/password", params: { user: { reset_password_token: raw, password: "another orchard after gentle rain", password_confirmation: "another orchard after gentle rain" } }, as: :json
    expect(response).to have_http_status(:ok)
    expect(output.string).not_to include(raw, user.email, "another orchard after gentle rain")
  ensure
    ENV["WEB_APP_URL"] = old_url
    Rails.logger = old_logger
    ActiveJob::Base.logger = old_job
  end
end
