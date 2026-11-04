# The email rules behind sign-up limits: mailbox grouping, throwaway domains and the domain cap.
require "rails_helper"

RSpec.describe Accounts::SignUpEmailRules do
  describe ".mailbox" do
    it "drops the +tag, case and surrounding spaces" do
      expect(described_class.mailbox(" Person+Jobs+More@Example.com ")).to eq("person@example.com")
    end

    it "leaves an address without a tag alone" do
      expect(described_class.mailbox("person@example.com")).to eq("person@example.com")
    end

    it "keeps an address that is only a tag, rather than making it empty" do
      expect(described_class.mailbox("+tag@example.com")).to eq("+tag@example.com")
    end

    it "gives a malformed address a stable key" do
      expect(described_class.mailbox("not-an-email")).to eq(described_class.mailbox("NOT-AN-EMAIL"))
    end
  end

  describe ".disposable?" do
    it "matches listed domains and their subdomains" do
      expect(described_class.disposable?("a@yopmail.com")).to be(true)
      expect(described_class.disposable?("a@x.y.yopmail.com")).to be(true)
    end

    it "does not match other domains or malformed addresses" do
      expect(described_class.disposable?("a@example.com")).to be(false)
      expect(described_class.disposable?("nothing")).to be(false)
    end

    it "reads the list without its comments" do
      expect(described_class::DISPOSABLE_DOMAINS).to include("mailinator.com")
      expect(described_class::DISPOSABLE_DOMAINS.grep(/\A#|\s/)).to be_empty
    end
  end

  describe ".domain_limit_reached?" do
    around do |example|
      original_store = Rack::Attack.cache.store
      Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
      example.run
    ensure
      Rack::Attack.cache.store = original_store
    end

    before { stub_const("#{described_class}::DOMAIN_DAILY_LIMIT", 1) }

    it "allows up to the limit, then refuses" do
      expect(described_class.domain_limit_reached?("a@example.org")).to be(false)
      expect(described_class.domain_limit_reached?("b@example.org")).to be(true)
    end

    it "shares a cap across subdomains, including under a multi-part suffix" do
      expect(described_class.domain_limit_reached?("a@one.example.co.uk")).to be(false)
      expect(described_class.domain_limit_reached?("b@two.example.co.uk")).to be(true)
    end

    it "keeps separate caps for different owners under one suffix" do
      expect(described_class.domain_limit_reached?("a@first.co.uk")).to be(false)
      expect(described_class.domain_limit_reached?("a@second.co.uk")).to be(false)
    end

    it "exempts public providers" do
      2.times { expect(described_class.domain_limit_reached?("a@gmail.com")).to be(false) }
    end

    it "copes with a domain the suffix list rejects" do
      expect { described_class.domain_limit_reached?("a@localhost") }.not_to raise_error
    end
  end
end
