# Description: Gives Devise a no-op session in API-only mode. Devise writes to the session
# during sign-in/sign-up, which raises because API mode disables sessions; auth is JWT-only.
# Index:
#   - set_fake_rack_session: installs an empty, disabled session before each action
module FakeRackSession
  extend ActiveSupport::Concern

  # A Hash that reports itself as a disabled session.
  class DisabledSession < Hash
    def enabled? = false
    def destroy; end
  end

  included do
    before_action :set_fake_rack_session
  end

  private

  # Installs a disabled session so Devise's session writes are harmless.
  def set_fake_rack_session
    request.env["rack.session"] ||= DisabledSession.new
  end
end
