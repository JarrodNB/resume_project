# Description: Only sign up, sign in, and sign out are routed under /auth; Devise's account
# update/delete and password reset routes must not exist.
require "rails_helper"

RSpec.describe "Auth routes", type: :routing do
  it "routes sign up, sign in, and sign out" do
    expect(post: "/auth/sign_up").to route_to("auth/registrations#create", format: :json)
    expect(post: "/auth/sign_in").to route_to("auth/sessions#create", format: :json)
    expect(delete: "/auth/sign_out").to route_to("auth/sessions#destroy", format: :json)
  end

  it "does not route account update or deletion" do
    expect(delete: "/auth/sign_up").not_to be_routable
    expect(put: "/auth/sign_up").not_to be_routable
    expect(patch: "/auth/sign_up").not_to be_routable
    expect(get: "/auth/sign_up/edit").not_to be_routable
    expect(get: "/auth/sign_up/cancel").not_to be_routable
  end

  it "does not route password reset" do
    expect(post: "/auth/password").not_to be_routable
    expect(put: "/auth/password").not_to be_routable
    expect(get: "/auth/password/new").not_to be_routable
  end
end
