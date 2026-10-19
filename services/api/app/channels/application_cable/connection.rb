# Live connections use the same persisted session as HTTP. Every private send and
# operation rechecks it so logout/expiry stop delivery even before the socket closes.
module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      public_id = request.session[:session_id]
      @browser_session_id = Rack::Session::SessionId.new(public_id) if public_id.present?
      identity = BrowserSessions::ResolveSessionIdentityService.call(session_id: @browser_session_id)
      reject_unauthorized_connection unless identity.success?
      self.current_user = identity.value
    end

    def session_valid?
      identity = BrowserSessions::ResolveSessionIdentityService.call(session_id: @browser_session_id)
      identity.success? && identity.value.id == current_user.id
    end

    def check_session
      close(reason: "Session expired", reconnect: false) unless session_valid?
    end

    # Rails already invokes this heartbeat; no extra timer or session protocol is needed.
    def beat
      session_valid? ? super : check_session
    end
  end
end
