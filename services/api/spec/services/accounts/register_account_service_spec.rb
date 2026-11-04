# Sign-up's email limits at the service boundary, including that duplicates stay hidden.
require "rails_helper"

RSpec.describe Accounts::RegisterAccountService do
  def register(email)
    described_class.call(attributes: { email: email, password: "a quiet orchard after rain" }, challenge_token: "token")
  end

  it "refuses a disposable domain, whether or not the account exists" do
    create(:user, email: "taken@yopmail.com")

    [ "taken@yopmail.com", "free@yopmail.com" ].each do |email|
      expect(register(email).errors).to eq([ described_class::DISPOSABLE_EMAIL ])
    end
    expect(User.exists?(email: "free@yopmail.com")).to be(false)
  end

  it "stores a plus-address exactly as given" do
    expect(register("Person+Jobs@Example.org")).to be_success
    expect(User.last.email).to eq("person+jobs@example.org")
  end

  context "when the domain is over its cap" do
    before { allow(Accounts::SignUpEmailRules).to receive(:domain_limit_reached?).and_return(true) }

    it "succeeds without an account or email" do
      expect {
        expect { expect(register("new@example.org")).to be_success }.not_to change(User, :count)
      }.not_to have_enqueued_job
    end

    it "still reports invalid fields, the same as under the cap" do
      expect(described_class.call(attributes: { email: "new@example.org", password: "x" }, challenge_token: "token")).not_to be_success
    end
  end

  it "does not spend a domain's cap on a duplicate" do
    create(:user, email: "taken@example.org")
    allow(Accounts::SignUpEmailRules).to receive(:domain_limit_reached?).and_call_original

    expect(register("taken@example.org")).to be_success
    expect(Accounts::SignUpEmailRules).not_to have_received(:domain_limit_reached?)
  end
end
