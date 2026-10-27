# Checks the persisted Rails session for HTTP and live connections. Devise validates
# the serialized user and password salt; the timestamp limits authentication to one day.
module BrowserSessions
  class ResolveSessionIdentityService < ApplicationService
    def initialize(session_id: nil, private_id: nil)
      @private_id = session_id&.private_id || private_id
    end

    def call
      return failure([ "Signed out" ]) unless @private_id.is_a?(String) && @private_id.present?
      record = ActiveRecord::SessionStore::Session.find_by_session_id(@private_id)
      data = record&.data || {}
      authenticated_at = data["authenticated_at"]
      key = data["warden.user.user.key"]
      return failure([ "Signed out" ]) unless authenticated_at.is_a?(Integer) && key.is_a?(Array)
      return failure([ "Session expired" ]) unless authenticated_at > 1.day.ago.to_i && authenticated_at <= Time.current.to_i
      user = User.serialize_from_session(*key)
      user&.active_for_authentication? ? success(user) : failure([ "Signed out" ])
    end
  end
end
