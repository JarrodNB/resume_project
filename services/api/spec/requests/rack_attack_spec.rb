# Exercises HTTP auth, email and session throttles with real in-memory counters.
# Equivalent request encodings must share limits; malformed input cannot bypass them.
require "rails_helper"

RSpec.describe "Rack::Attack throttling", type: :request do
  let(:json_headers) { { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json" } }

  # The test cache is a null store, so throttles never trip elsewhere; use a real one here.
  around do |example|
    original_store = Rack::Attack.cache.store
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    example.run
  ensure
    Rack::Attack.cache.store = original_store
  end

  # Posts a sign-in attempt from the given IP.
  def sign_in(email:, ip: "10.0.0.1")
    post "/auth/sign_in",
         params: { user: { email: email, password: "wrong-password" } }.to_json,
         headers: json_headers.merge("REMOTE_ADDR" => ip)
  end

  it "returns a JSON 429 with Retry-After after 5 sign-in attempts from one IP" do
    5.times { |attempt| sign_in(email: "user#{attempt}@example.com") }
    expect(response).to have_http_status(:unauthorized)

    sign_in(email: "another@example.com")

    expect(response).to have_http_status(:too_many_requests)
    expect(response.headers["retry-after"].to_i).to be_between(1, 20)
    expect(response.parsed_body["errors"].first).to start_with("Too many requests")
  end

  it "throttles sign-in attempts for one email across IPs" do
    10.times { |attempt| sign_in(email: "Target@Example.com ", ip: "10.0.1.#{attempt}") }

    sign_in(email: "target@example.com", ip: "10.0.2.1")

    expect(response).to have_http_status(:too_many_requests)
  end

  # Posts a valid sign-up with a new email, with the given request headers.
  def sign_up(attempt, **headers)
    post "/auth/sign_up",
         params: { user: { email: "bot#{attempt}@example.com", password: "a quiet orchard after rain" }, turnstile_token: "token" },
         as: :json, headers: headers
    response.status
  end

  describe "sign-up limits" do
    it "allows 5 accounts per hour from one IP, then refuses without creating more" do
      statuses = 6.times.map { |attempt| sign_up(attempt, "REMOTE_ADDR" => "8.8.8.8") }

      expect(statuses).to eq([ 202 ] * 5 + [ 429 ])
      expect(User.count).to eq(5)
      expect(response.headers["retry-after"].to_i).to be_between(1, 3600)
    end

    it "shares a limit across format aliases" do
      5.times { |attempt| sign_up(attempt, "REMOTE_ADDR" => "8.8.8.8") }
      post "/auth/sign_up.json", params: { user: { email: "alias@example.com" } }, as: :json, headers: { "REMOTE_ADDR" => "8.8.8.8" }
      expect(response).to have_http_status(:too_many_requests)
    end

    it "counts every address in one IPv6 /64 together" do
      statuses = 6.times.map { |attempt| sign_up(attempt, "REMOTE_ADDR" => "2001:db8:1:1::#{attempt + 1}") }
      expect(statuses.last).to eq(429)
    end

    it "keeps separate IPv6 /64 networks apart" do
      5.times { |attempt| sign_up(attempt, "REMOTE_ADDR" => "2001:db8:1:1::#{attempt + 1}") }
      expect(sign_up(9, "REMOTE_ADDR" => "2001:db8:1:2::1")).to eq(202)
    end

    it "counts IPv4 written in IPv6 form with plain IPv4" do
      5.times { |attempt| sign_up(attempt, "REMOTE_ADDR" => "8.8.8.8") }
      expect(sign_up(9, "REMOTE_ADDR" => "::ffff:8.8.8.8")).to eq(429)
    end

    it "ignores a Forwarded header set by the client behind a private proxy" do
      statuses = 6.times.map do |attempt|
        sign_up(attempt, "REMOTE_ADDR" => "10.0.0.5", "HTTP_X_FORWARDED_FOR" => "8.8.8.8", "HTTP_FORWARDED" => "for=1.2.3.#{attempt}")
      end
      expect(statuses.last).to eq(429)
    end

    it "ignores X-Forwarded-For values the client added before the proxy's" do
      statuses = 6.times.map do |attempt|
        sign_up(attempt, "REMOTE_ADDR" => "10.0.0.5", "HTTP_X_FORWARDED_FOR" => "1.2.3.#{attempt}, 8.8.8.8")
      end
      expect(statuses.last).to eq(429)
    end

    context "behind a trusted public proxy" do
      before { stub_const("RackAttackRequestKeys::TRUSTED_PROXY_CIDRS", [ IPAddr.new("172.64.0.0/13") ]) }

      it "gives clients behind one edge IP separate limits" do
        5.times { |attempt| sign_up(attempt, "REMOTE_ADDR" => "10.0.0.5", "HTTP_X_FORWARDED_FOR" => "9.9.9.9, 172.70.1.1") }
        expect(sign_up(8, "REMOTE_ADDR" => "10.0.0.5", "HTTP_X_FORWARDED_FOR" => "9.9.9.9, 172.70.1.1")).to eq(429)
        expect(sign_up(9, "REMOTE_ADDR" => "10.0.0.5", "HTTP_X_FORWARDED_FOR" => "9.9.9.10, 172.70.1.1")).to eq(202)
      end

      it "still counts the real client when it forges earlier hops" do
        statuses = 6.times.map do |attempt|
          sign_up(attempt, "REMOTE_ADDR" => "10.0.0.5", "HTTP_X_FORWARDED_FOR" => "1.2.3.#{attempt}, 9.9.9.9, 172.70.1.1")
        end
        expect(statuses.last).to eq(429)
      end

      it "does not treat a forged, unparseable hop as a proxy" do
        statuses = 6.times.map do |attempt|
          sign_up(attempt, "REMOTE_ADDR" => "8.8.8.8", "HTTP_X_FORWARDED_FOR" => "not-an-ip-#{attempt}")
        end
        expect(statuses.last).to eq(429)
      end
    end
  end

  it "throttles GraphQL per signed-in user across routed JSON format aliases" do
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }.to_json, headers: json_headers
    auth_headers = json_headers

    120.times { |request_number| post(request_number.even? ? "/graphql" : "/graphql.json", params: { query: "{ me { email } }" }.to_json, headers: auth_headers) }
    expect(response).to have_http_status(:ok)

    post "/graphql.json", params: { query: "{ me { email } }" }.to_json, headers: auth_headers

    expect(response).to have_http_status(:too_many_requests)
  end

  it "bounds confirmation requests by IP, including malformed requests" do
    6.times { post "/auth/confirmation", params: { user: { email: "bad" } }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
    expect(response.headers["retry-after"]).to be_present
    11.times { post "/auth/confirmation/verify", params: { confirmation_token: [] }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
  end

  it "bounds confirmation email delivery across different IPs" do
    6.times do |n|
      post "/auth/confirmation", params: { user: { email: " Unknown@Example.com " } }, as: :json, headers: { "REMOTE_ADDR" => "10.9.0.#{n}" }
    end
    expect(response).to have_http_status(:too_many_requests)
  end

  it "bounds recovery mail, reset guessing and password change including malformed requests" do
    6.times { post "/auth/password", params: { user: { email: "bad" } }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
    11.times { put "/auth/password", params: { user: { reset_password_token: [] } }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
    6.times { patch "/auth/password/change", params: { user: { current_password: "bad" } }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
  end

  it "bounds recovery delivery to one email across IPs" do
    6.times do |n|
      post "/auth/password", params: { user: { email: " Unknown@Example.com " } }, as: :json, headers: { "REMOTE_ADDR" => "10.8.0.#{n}" }
    end
    expect(response).to have_http_status(:too_many_requests)
  end

  [ "/auth/confirmation", "/auth/password" ].each do |endpoint|
    it "shares #{endpoint} mailbox limits across accepted encodings and query parameters" do
      account = build(:user, email: "mailbox@example.com", confirmed_at: endpoint == "/auth/confirmation" ? nil : Time.current)
      account.skip_confirmation_notification!
      account.save!
      query = Rack::Utils.build_nested_query(user: { email: account.email.upcase })
      boundary = "account-mail-throttle"
      multipart = "--#{boundary}\r\nContent-Disposition: form-data; name=\"user[email]\"\r\n\r\n#{account.email}\r\n--#{boundary}--\r\n"
      attempts = [
        [ endpoint, { params: { user: { email: account.email } }, as: :json } ],
        [ endpoint, { params: { user: { email: account.email } } } ],
        [ endpoint, { params: multipart, headers: { "CONTENT_TYPE" => "multipart/form-data; boundary=#{boundary}" } } ],
        [ "#{endpoint}?#{query}", { params: {}, as: :json } ],
        [ "#{endpoint}?#{query}", { params: { user: { email: "decoy@example.com" } }, as: :json } ]
      ]
      attempts.each_with_index do |(path, options), index|
        post path, **options.merge(headers: (options[:headers] || {}).merge("ACCEPT" => "application/json", "REMOTE_ADDR" => "10.7.0.#{index}"))
        expect(response).to have_http_status(:accepted)
      end
      persisted = account.reload.attributes
      post endpoint, params: { user: { email: account.email } }, headers: { "ACCEPT" => "application/json", "REMOTE_ADDR" => "10.7.0.6" }
      expect(response).to have_http_status(:too_many_requests)
      expect(account.reload.attributes).to eq(persisted)
    end
  end

  [ "/auth/confirmation", "/auth/password" ].each do |endpoint|
    it "shares #{endpoint} limits across routed JSON format aliases" do
      paths = [ endpoint, "#{endpoint}.json", "#{endpoint}.json/" ]
      5.times do |index|
        post paths[index % paths.size], params: { user: { email: "mailbox@example.com" } }, as: :json
        expect(response).to have_http_status(:accepted)
      end
      post "#{endpoint}.json", params: { user: { email: "mailbox@example.com" } }, as: :json
      expect(response).to have_http_status(:too_many_requests)
    end
  end

  describe "sign-up mailbox limits" do
    # Posts from a new IP each time, so only the mailbox limit can trip.
    def sign_up_as(email)
      @sign_up_ip = @sign_up_ip.to_i + 1
      post "/auth/sign_up", params: { user: { email: email, password: "a quiet orchard after rain" }, turnstile_token: "token" },
           as: :json, headers: { "REMOTE_ADDR" => "8.8.4.#{@sign_up_ip}" }
      response.status
    end

    it "counts plus-addresses as one mailbox across IPs, ignoring case" do
      statuses = 6.times.map { |attempt| sign_up_as("Person+#{attempt}@Gmail.com") }

      expect(statuses).to eq([ 202 ] * 5 + [ 429 ])
      expect(response.headers["retry-after"]).to be_present
      expect(sign_up_as("person@gmail.com")).to eq(429)
    end

    it "keeps each stored address exactly as the user wrote it, tag included" do
      sign_up_as("person+jobs@gmail.com")
      sign_up_as("person+other@gmail.com")

      expect(User.pluck(:email)).to contain_exactly("person+jobs@gmail.com", "person+other@gmail.com")
    end

    it "does not share a limit with another mailbox or a same-named one elsewhere" do
      5.times { |attempt| sign_up_as("person+#{attempt}@gmail.com") }

      expect(sign_up_as("someone@gmail.com")).to eq(202)
      expect(sign_up_as("person@outlook.com")).to eq(202)
    end

    it "caps one mailbox per day even when spread across hours" do
      travel_to(Time.current.beginning_of_day + 1.minute)
      statuses = 11.times.map do |attempt|
        travel 1.hour if attempt == 5
        sign_up_as("person+#{attempt}@gmail.com")
      end

      expect(statuses).to eq([ 202 ] * 10 + [ 429 ])
    end

    it "answers the same way whether or not the account exists" do
      create(:user, email: "taken@gmail.com")

      expect(5.times.map { sign_up_as("taken@gmail.com") }).to eq([ 202 ] * 5)
      expect(sign_up_as("taken@gmail.com")).to eq(429)
      expect(5.times.map { sign_up_as("free@gmail.com") }).to all(eq(202))
      expect(sign_up_as("free@gmail.com")).to eq(429)
    end
  end

  describe "sign-up domain cap" do
    before { stub_const("Accounts::SignUpEmailRules::DOMAIN_DAILY_LIMIT", 2) }

    def sign_up_new(email, ip)
      post "/auth/sign_up", params: { user: { email: email, password: "a quiet orchard after rain" }, turnstile_token: "token" },
           as: :json, headers: { "REMOTE_ADDR" => "8.8.5.#{ip}" }
      response
    end

    it "returns the same 202 over the cap, without an account or email, and across subdomains" do
      sign_up_new("one@corp.example.org", 1)
      sign_up_new("two@mail.corp.example.org", 2)
      expect {
        expect {
          expect(sign_up_new("three@corp.example.org", 3)).to have_http_status(:accepted)
        }.not_to change(User, :count)
      }.not_to have_enqueued_job
      expect(response.parsed_body["message"]).to eq(Accounts::RegisterAccountService::MESSAGE)
    end

    it "does not count duplicates, and gives a duplicate the same answer over the cap" do
      create(:user, email: "taken@example.org")
      3.times { |attempt| expect(sign_up_new("taken@example.org", attempt)).to have_http_status(:accepted) }
      sign_up_new("one@example.org", 4)
      sign_up_new("two@example.org", 5)
      over_cap_new = sign_up_new("three@example.org", 6).parsed_body
      over_cap_duplicate = sign_up_new("taken@example.org", 7).parsed_body

      expect(User.where("email LIKE ?", "%@example.org").count).to eq(3)
      expect(over_cap_duplicate).to eq(over_cap_new)
    end

    it "exempts large public providers" do
      expect { 3.times { |attempt| sign_up_new("person#{attempt}@gmail.com", attempt) } }.to change(User, :count).by(3)
    end

    it "lets the domain sign up again in a later window" do
      3.times { |attempt| sign_up_new("person#{attempt}@example.org", attempt) }
      travel 1.day
      expect { sign_up_new("later@example.org", 9) }.to change(User, :count).by(1)
    end
  end

  it "shares the persisted-session creation limit between HEAD, GET and routed aliases" do
    travel_to(Time.current.beginning_of_minute + 10.seconds)
    initial_count = ActiveRecord::SessionStore::Session.count
    30.times do |index|
      browser = ActionDispatch::Integration::Session.new(Rails.application)
      path = index % 3 == 0 ? "/auth/session.json" : "/auth/session"
      browser.public_send(index.even? ? :head : :get, path, headers: { "REMOTE_ADDR" => "10.7.4.1" })
      expect(browser.response).to have_http_status(:ok)
    end
    expect(ActiveRecord::SessionStore::Session.count).to eq(initial_count + 30)
    browser = ActionDispatch::Integration::Session.new(Rails.application)
    browser.head "/auth/session.json", headers: { "REMOTE_ADDR" => "10.7.4.1" }
    expect(browser.response).to have_http_status(:too_many_requests)
    expect(ActiveRecord::SessionStore::Session.count).to eq(initial_count + 30)
  end
end
