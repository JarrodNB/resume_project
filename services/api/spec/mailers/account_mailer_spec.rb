require "rails_helper"

RSpec.describe AccountMailer, type: :mailer do
  describe "#trial_ending" do
    let(:user) { build(:user, email: "pat@example.com", trial_ends_at: Time.utc(2026, 11, 28, 15)) }
    let(:mail) { described_class.trial_ending(user) }

    around do |example|
      original = ENV["WEB_APP_URL"]
      ENV["WEB_APP_URL"] = "https://app.example.test/"
      example.run
    ensure
      ENV["WEB_APP_URL"] = original
    end

    it "addresses the user with a clear subject" do
      expect(mail.to).to eq([ "pat@example.com" ])
      expect(mail.subject).to eq("Your Careerdrafter free trial ends soon")
    end

    it "gives the end date, what stops, what stays, and a billing link" do
      body = mail.body.encoded
      expect(body).to include("ends on Saturday, November 28 (UTC)")
      expect(body).not_to match(/tomorrow/i)
      expect(mail.subject).not_to match(/tomorrow/i)
      expect(body).to include("AI features")
      expect(body).to include("saved work")
      expect(body).to include("https://app.example.test/account/billing")
      expect(body).not_to include("//account/billing")
    end
  end
end
