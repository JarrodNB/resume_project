# A held owner lock cannot keep an internal HTTP callback waiting indefinitely.
require "rails_helper"

RSpec.describe "Internal interview database timeout", type: :request do
  self.use_transactional_tests = false
  it "returns a recoverable error when another transaction holds the owner lock" do
    user = create(:user)
    operation = Interviews::CreateFixtureService.call(user: user).value.operations.first
    original = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "timeout-test"
    ready = Queue.new
    holder = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        User.find(user.id).with_lock do
          ready << true
          sleep 3
        end
      end
    end
    Timeout.timeout(5) { ready.pop }
    post "/internal/interviews/operations/#{operation.id}/claim", headers: { "Authorization" => "Bearer timeout-test" }, as: :json
    expect(response).to have_http_status(:service_unavailable)
    expect(operation.reload.execution_count).to eq(0)
  ensure
    holder&.join
    ENV["INTERVIEW_SERVICE_SECRET"] = original
    user&.destroy!
  end
end
