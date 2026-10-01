# Description: Sign up. On success the new user is signed in and the JWT is returned in the
# Authorization response header.
# Index:
#   - respond_with: JSON body for sign-up success or validation errors
#   - sign_up_params: permitted sign-up fields
module Auth
  class RegistrationsController < Devise::RegistrationsController
    include FakeRackSession

    private

    # Renders the created user, or validation errors.
    def respond_with(user, _options = {})
      if user.persisted?
        render json: { user: { id: user.id, email: user.email, name: user.name } }, status: :created
      else
        render json: { errors: user.errors.full_messages }, status: :unprocessable_content
      end
    end

    # Permits name in addition to Devise's email and password.
    def sign_up_params
      params.require(:user).permit(:name, :email, :password)
    end
  end
end
