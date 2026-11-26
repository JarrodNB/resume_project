# Description: Profile links must be web addresses, because the app opens them and exports them.
require "rails_helper"

RSpec.describe User, "links" do
  let(:user) { create(:user) }

  def link(url) = [ { "label" => "Site", "url" => url } ]

  it "accepts http and https addresses" do
    user.links = link("https://example.com/me") + link("HTTP://example.com:8080/a?b=1#c")

    expect(user).to be_valid
  end

  it "rejects other schemes, control characters and addresses without a scheme" do
    [ "javascript:alert(1)", "java\tscript:alert(1)", "\u0001javascript:alert(1)", "data:text/html,x",
      "mailto:a@example.com", "example.com/me", "https://", "https://exa mple.com", "//example.com" ].each do |url|
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
