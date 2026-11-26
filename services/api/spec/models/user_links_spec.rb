# Description: Profile links must be web addresses, because the app opens them and exports them.
require "rails_helper"

RSpec.describe User, "links" do
  let(:user) { create(:user) }

  def link(url) = [ { "label" => "Site", "url" => url } ]

  it "accepts http and https addresses" do
    user.links = link("https://example.com/me") + link("HTTP://example.com:8080/a?b=1#c") +
      link("https://bücher.de/x") + link("https://example.com/日本") + link("https://example.com/a|b^c{d}`e") +
      link("https://[::1]:3000/x")

    expect(user).to be_valid
  end

  it "rejects other schemes, control characters and addresses without a scheme" do
    [ "javascript:alert(1)", "java\tscript:alert(1)", "\u0001javascript:alert(1)", "data:text/html,x",
      "mailto:a@example.com", "example.com/me", "https://", "https://exa mple.com", "//example.com",
      "https://google.com@evil.com", "https://user:pw@example.com", "https://example.com/\u202Eexe.pdf",
      "https://example.com/a\u200Bb", "https://example.com/a\u00A0b", "https://example.com/a\u2028b",
      "https://example.com\\@evil.com", "https:///x", "https://example.com/x\n" ].each do |url|
      user.links = link(url)

      expect(user).not_to be_valid, "expected #{url.inspect} to be rejected"
      expect(user.errors[:links]).to include("must use web addresses that start with http:// or https://")
    end
  end

  it "does not block an unrelated save when older saved links are not web addresses" do
    user.update_column(:links, link("javascript:alert(1)"))

    expect(user.reload.update(name: "Ada")).to be(true)
  end

  it "refuses an unsafe link through the profile service without changing saved links" do
    user.update!(links: link("https://example.com/me"))

    result = Users::UpdateProfileService.call(user: user, attributes: { links: link("javascript:alert(1)") })

    expect(result).not_to be_success
    expect(user.reload.links).to eq(link("https://example.com/me"))
  end
end

RSpec.describe WebAddress do
  it "adds https:// to a bare domain and leaves everything else alone" do
    expect(described_class.normalize(" linkedin.com/in/jane ")).to eq("https://linkedin.com/in/jane")
    expect(described_class.normalize("example.com:8080/x")).to eq("https://example.com:8080/x")
    expect(described_class.normalize("javascript:alert(1)")).to eq("javascript:alert(1)")
    expect(described_class.normalize("jane@example.com")).to eq("jane@example.com")
    expect(described_class.normalize(nil)).to be_nil
  end

  it "refuses text that is not valid UTF-8 instead of raising" do
    expect(described_class.valid?("https://example.com/\xFF".dup.force_encoding("UTF-8"))).to be(false)
  end
end
