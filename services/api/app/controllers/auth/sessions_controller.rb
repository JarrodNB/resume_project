# Description: Sign in / sign out. devise-jwt adds the JWT to the Authorization response
# header on sign-in and revokes it on sign-out.
# Index:
#   - respond_with: JSON body for a successful sign-in
#   - respond_to_on_destroy: JSON body for sign-out
module Auth
  class SessionsController < Devise::SessionsController
    include FakeRackSession

    private

    # Renders the signed-in user. The token itself is in the Authorization header.
    def respond_with(user, _options = {})
      render json: { user: { id: user.id, email: user.email, name: user.name } }, status: :ok
    end

    # Renders the sign-out result.
    def respond_to_on_destroy(*)
      if current_user
        render json: { message: "Signed out" }, status: :ok
      else
        render json: { error: "Not signed in" }, status: :unauthorized
      end
    end
  end
end
