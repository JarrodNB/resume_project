# Uses committed records and actual row locks to exercise competing password operations.
require "rails_helper"

RSpec.describe "Password concurrency" do
  self.use_transactional_tests = false
  let(:replacement) { "another orchard after gentle rain" }

  it "consumes a recovery token once under concurrent attempts" do
    user = create(:user)
    token = user.send_reset_password_instructions
    gate = Queue.new
    threads = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          gate.pop
          Accounts::ResetPasswordService.call(token: token, password: replacement, password_confirmation: replacement).success?
        end
      end
    end
    2.times { gate << true }
    expect(threads.map(&:value).sort_by(&:to_s)).to eq([ false, true ])
    expect(user.reload.valid_password?(replacement)).to be(true)
  ensure
    threads&.each(&:join)
    user&.destroy!
  end

  it "rejects stale current credentials when two password changes race" do
    user = create(:user)
    gate = Queue.new
    threads = 2.times.map do |n|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          stale = User.find(user.id)
          gate.pop
          Accounts::ChangePasswordService.call(user: stale, current_password: "a quiet orchard after rain", password: "#{replacement} #{n}", password_confirmation: "#{replacement} #{n}").success?
        end
      end
    end
    2.times { gate << true }
    expect(threads.map(&:value).sort_by(&:to_s)).to eq([ false, true ])
  ensure
    threads&.each(&:join)
    user&.destroy!
  end

  it "does not preserve a session serialized after reset from a user authenticated before reset" do
    user = create(:user)
    authenticated = User.find(user.id)
    expect(authenticated.valid_password?("a quiet orchard after rain")).to be(true)
    token = user.send_reset_password_instructions
    expect(Accounts::ResetPasswordService.call(token: token, password: replacement, password_confirmation: replacement)).to be_success
    session_id = Rack::Session::SessionId.new(SecureRandom.hex(32))
    record = ActiveRecord::SessionStore::Session.create!(session_id: session_id.private_id,
      data: { "warden.user.user.key" => User.serialize_into_session(authenticated), "authenticated_at" => Time.current.to_i })
    expect(BrowserSessions::ResolveSessionIdentityService.call(session_id: session_id)).not_to be_success
    expect(User.serialize_from_session(*User.serialize_into_session(authenticated))).to be_nil
  ensure
    record&.destroy!
    user&.destroy!
  end

  it "rejects an old token after a racing resend replaces it" do
    user = create(:user)
    old = user.send_reset_password_instructions
    locked, release = Queue.new, Queue.new
    sender = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        user.with_lock do
          locked << true
          release.pop
          Accounts::RequestPasswordResetService.call(email: user.email)
        end
      end
    end
    locked.pop
    resetter = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        Accounts::ResetPasswordService.call(token: old, password: replacement, password_confirmation: replacement)
      end
    end
    release << true
    expect(sender.value).to be_success
    expect(resetter.value).not_to be_success
    expect(user.reload.valid_password?("a quiet orchard after rain")).to be(true)
  ensure
    release << true if release
    sender&.join
    resetter&.join
    user&.destroy!
  end

  it "allows only one of a competing reset and old-current-password change to succeed" do
    user = create(:user)
    token = user.send_reset_password_instructions
    gate = Queue.new
    threads = [ :reset, :change ].map do |operation|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          stale = User.find(user.id)
          gate.pop
          if operation == :reset
            Accounts::ResetPasswordService.call(token: token, password: replacement, password_confirmation: replacement).success?
          else
            Accounts::ChangePasswordService.call(user: stale, current_password: "a quiet orchard after rain", password: "#{replacement} changed", password_confirmation: "#{replacement} changed").success?
          end
        end
      end
    end
    2.times { gate << true }
    expect(threads.map(&:value).sort_by(&:to_s)).to eq([ false, true ])
    expect(user.reload.reset_password_token).to be_nil
  ensure
    threads&.each(&:join)
    user&.destroy!
  end

  it "cannot authenticate a surviving session when a real sign-in read races with reset" do
    browser = ActionDispatch::Integration::Session.new(Rails.application)
    browser.get "/auth/session"
    user = create(:user)
    token = user.send_reset_password_instructions
    found, release = Queue.new, Queue.new
    # Pause only after the actual Devise lookup; password comparison and HTTP session
    # middleware remain real, using the old record a concurrent login already loaded.
    allow(User).to receive(:find_for_database_authentication).and_wrap_original do |lookup, conditions|
      account = lookup.call(conditions)
      if account&.id == user.id
        found << true
        release.pop
      end
      account
    end
    signer = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        browser.post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }, as: :json
      end
    end
    Timeout.timeout(10) { found.pop }
    expect(Accounts::ResetPasswordService.call(token: token, password: replacement, password_confirmation: replacement)).to be_success
    release << true
    signer.value
    expect(browser.response).to have_http_status(:ok)
    browser.get "/auth/session"
    expect(browser.response.parsed_body["user"]).to be_nil
    browser.post "/graphql", params: { query: "{ me { email } }" }, as: :json
    expect(browser.response).to have_http_status(:unauthorized)
  ensure
    release << true if release
    signer&.join
    user&.destroy!
  end
end
