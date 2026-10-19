# Browser session state has a bounded anonymous bootstrap and no token authentication bypass.
require "rails_helper"

RSpec.describe "Browser session abuse", type: :request do
  it "throttles repeated anonymous session creation" do
    original = Rack::Attack.cache.store
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    31.times do
      get "/auth/session", headers: { "REMOTE_ADDR" => "10.40.1.1" }
    end
    expect(response).to have_http_status(:too_many_requests)
  ensure
    Rack::Attack.cache.store = original
  end

  it "allows credentialed CORS only for the configured web origin" do
    options "/graphql", headers: { "HTTP_ORIGIN" => "http://localhost:5173", "HTTP_ACCESS_CONTROL_REQUEST_METHOD" => "POST", "HTTP_ACCESS_CONTROL_REQUEST_HEADERS" => "x-csrf-token" }
    expect(response.headers["Access-Control-Allow-Origin"]).to eq("http://localhost:5173")
    expect(response.headers["Access-Control-Allow-Credentials"]).to eq("true")
    options "/graphql", headers: { "HTTP_ORIGIN" => "https://hostile.example", "HTTP_ACCESS_CONTROL_REQUEST_METHOD" => "POST" }
    expect(response.headers["Access-Control-Allow-Origin"]).to be_nil
  end
end
