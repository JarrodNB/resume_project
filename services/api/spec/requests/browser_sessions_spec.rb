# Proves browser cookies, CSRF, and server-side revocation through real HTTP requests.
require "rails_helper"

RSpec.describe "Browser sessions", type: :request do
  let(:headers) { { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json", "HTTP_ORIGIN" => "http://localhost:5173" } }

  around do |example|
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    example.run
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  def bootstrap
    get "/auth/session", headers: headers
    expect(response).to have_http_status(:ok)
    response.parsed_body.fetch("csrfToken")
  end

  def login
    token = bootstrap
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }.to_json,
      headers: headers.merge("X-CSRF-Token" => token)
    expect(response).to have_http_status(:ok)
    expect(response.headers["Authorization"]).to be_nil
    user
  end

  it "bootstraps anonymous browsers without caching credentials" do
    expect(bootstrap).to be_present
    expect(response.parsed_body["user"]).to be_nil
    expect(response.headers["Cache-Control"]).to include("no-store")
  end

  it "requires CSRF even on login" do
    post "/auth/sign_in", params: { user: { email: "missing@example.com", password: "a quiet orchard after rain" } }.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq([ "Invalid CSRF token" ])
  end

  it "requires CSRF on signup and logout" do
    post "/auth/sign_up", params: { user: { email: "ada@example.com", password: "a quiet orchard after rain" } }.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_content)
    delete "/auth/sign_out", headers: headers
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "accepts signup with CSRF and returns the newly authenticated session" do
    token = bootstrap
    post "/auth/sign_up", params: { user: { email: "ada@example.com", password: "a quiet orchard after rain" } }.to_json,
      headers: headers.merge("X-CSRF-Token" => token)
    expect(response).to have_http_status(:created)
    expect(response.parsed_body.dig("user", "email")).to eq("ada@example.com")
    expect(response.parsed_body["csrfToken"]).to be_present
    expect(response.headers["Authorization"]).to be_nil
    bootstrap
    expect(response.parsed_body.dig("user", "email")).to eq("ada@example.com")
  end

  it "uses cookies for GraphQL and rejects their replay after logout" do
    user = login
    cookie = response.headers.fetch("Set-Cookie").split(";").first
    token = bootstrap
    expect(response.parsed_body.dig("user", "id")).to eq(user.id)
    post "/graphql", params: { query: "{ me { email } }" }.to_json, headers: headers.merge("X-CSRF-Token" => token)
    expect(response.parsed_body.dig("data", "me", "email")).to eq(user.email)
    delete "/auth/sign_out", headers: headers.merge("X-CSRF-Token" => token)
    expect(response).to have_http_status(:ok)
    replay = ActionDispatch::Integration::Session.new(Rails.application)
    replay.get "/auth/session", headers: headers.merge("HTTP_COOKIE" => cookie)
    expect(replay.response.parsed_body["user"]).to be_nil
  end

  it "expires authentication after an absolute day" do
    login
    retained_cookie = response.headers.fetch("Set-Cookie").split(";").first
    travel 1.day + 1.second
    replay = ActionDispatch::Integration::Session.new(Rails.application)
    replay.get "/auth/session", headers: headers.merge("HTTP_COOKIE" => retained_cookie)
    expect(replay.response).to have_http_status(:ok)
    expect(replay.response.parsed_body["csrfToken"]).to be_present
    expect(replay.response.parsed_body["user"]).to be_nil
  end

  it "rotates the session ID and CSRF secret on login" do
    old_csrf = bootstrap
    old_cookie = cookies["_careergrind_session"]
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }.to_json,
      headers: headers.merge("X-CSRF-Token" => old_csrf)
    expect(cookies["_careergrind_session"]).not_to eq(old_cookie)
    post "/graphql", params: { query: "{ me { email } }" }.to_json, headers: headers.merge("X-CSRF-Token" => old_csrf)
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "rejects an untrusted origin even when its CSRF token is correct" do
    login
    token = bootstrap
    post "/graphql", params: { query: "{ me { email } }" }.to_json,
      headers: headers.merge("X-CSRF-Token" => token, "HTTP_ORIGIN" => "https://hostile.example")
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "requires CSRF for GraphQL JSON" do
    login
    [ nil, "wrong" ].each do |token|
      post "/graphql", params: { query: "{ me { email } }" }.to_json, headers: headers.merge("X-CSRF-Token" => token)
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  it "accepts a real multipart upload only with a valid CSRF token" do
    login
    token = bootstrap
    queue = instance_double(Shoryuken::Queue, send_message: nil)
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    params = {
      operations: { query: "mutation($file: Upload!) { parseResume(input: {file: $file}) { aiTask { id } errors } }", variables: { file: nil } }.to_json,
      map: { "0" => [ "variables.file" ] }.to_json,
      "0" => Rack::Test::UploadedFile.new(StringIO.new(minimal_pdf_bytes), "application/pdf", original_filename: "resume.pdf")
    }
    upload_headers = headers.except("CONTENT_TYPE")
    post "/graphql", params: params, headers: upload_headers
    expect(response).to have_http_status(:unprocessable_content)
    post "/graphql", params: params, headers: upload_headers.merge("X-CSRF-Token" => token)
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.dig("data", "parseResume", "errors")).to eq([]), response.body
    expect(response.parsed_body.dig("data", "parseResume", "aiTask", "id")).to be_present
  end
end
