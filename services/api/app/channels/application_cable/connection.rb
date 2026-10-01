# Description: WebSocket connection at /cable. Browsers can't set headers on WebSockets, so the
# JWT comes in the `token` query param (filtered from logs) and is checked like a REST request,
# including the revocation denylist.
# Index:
#   - connect: authenticates the user or rejects the connection
module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    # Sets current_user from the JWT, rejecting missing, invalid, expired, or revoked tokens.
    def connect
      self.current_user = Warden::JWTAuth::UserDecoder.new.call(request.params[:token], :user, nil)
    rescue JWT::DecodeError
      reject_unauthorized_connection
    end
  end
end
