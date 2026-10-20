# Shared browser security: Rails checks CSRF and Devise resolves identity from sessions.
class ApplicationController < ActionController::Base
  protect_from_forgery with: :exception
  before_action :expire_browser_session
  before_action :prevent_auth_caching

  rescue_from ActionController::InvalidAuthenticityToken do
    render json: { code: "invalid_csrf", errors: [ "Invalid CSRF token" ] }, status: :unprocessable_content
  end

  private

  def expire_browser_session
    if session["warden.user.user.key"] && !BrowserSessions::ResolveSessionIdentityService.call(session_id: session.id).success?
      sign_out
      reset_session
    end
  end

  def prevent_auth_caching
    response.headers["Cache-Control"] = "no-store"
  end

  # The web app and API use separate origins on the same site, including local ports.
  def valid_request_origin?
    request.origin.nil? || request.origin == request.base_url ||
      Rails.application.config.action_cable.allowed_request_origins.include?(request.origin)
  end
end
