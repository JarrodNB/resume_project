# Explicit session, signup and confirmation routes; arbitrary account changes remain unavailable.
require "rails_helper"

RSpec.describe "Auth routes", type: :routing do
  it "routes sign up, sign in, and sign out" do
    expect(post: "/auth/sign_up").to route_to("auth/registrations#create", format: :json)
    expect(post: "/auth/sign_in").to route_to("auth/sessions#create", format: :json)
    expect(delete: "/auth/sign_out").to route_to("auth/sessions#destroy", format: :json)
    expect(post: "/auth/confirmation").to route_to("auth/confirmations#create", format: :json)
    expect(post: "/auth/confirmation/verify").to route_to("auth/confirmations#verify", format: :json)
    expect(get: "/auth/confirmation").not_to be_routable
    expect(get: "/auth/confirmation/verify").not_to be_routable
  end

  it "does not route account update or deletion" do
    expect(delete: "/auth/sign_up").not_to be_routable
    expect(put: "/auth/sign_up").not_to be_routable
    expect(patch: "/auth/sign_up").not_to be_routable
    expect(get: "/auth/sign_up/edit").not_to be_routable
    expect(get: "/auth/sign_up/cancel").not_to be_routable
  end

  it "routes only explicit recovery and change writes" do
    expect(post: "/auth/password").to route_to("auth/passwords#create", format: :json)
    expect(put: "/auth/password").to route_to("auth/passwords#update", format: :json)
    expect(patch: "/auth/password/change").to route_to("auth/passwords#change", format: :json)
    expect(get: "/auth/password/new").not_to be_routable
    expect(get: "/auth/password/edit").not_to be_routable
    expect(get: "/auth/password").not_to be_routable
  end
end
