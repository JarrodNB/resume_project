# Creates an account through Devise and starts its first browser session.
# Index:
#   - respond_with: JSON body for sign-up success or validation errors
#   - sign_up_params: permitted sign-up fields
module Auth
  class RegistrationsController < Devise::RegistrationsController
    private

    # Renders the created user, or validation errors.
    def respond_with(user, _options = {})
      if user.persisted?
        session[:authenticated_at] = Time.current.to_i
        render json: { user: user.slice(:id, :email, :name), csrfToken: form_authenticity_token }, status: :created
      else
        render json: { errors: user.errors.full_messages }, status: :unprocessable_content
      end
    end

    # Permits name in addition to Devise's email and password.
    def sign_up_params
      params.expect(user: [ :name, :email, :password ])
    end
  end
end
