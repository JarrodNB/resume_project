# Safe browser session bootstrap and Devise sign-in/sign-out JSON responses.
module Auth
  class SessionsController < Devise::SessionsController
    skip_before_action :verify_signed_out_user, only: :destroy
    before_action :validate_credentials_shape, only: :create
    def show
      render json: { user: current_user&.slice(:id, :email, :name), csrfToken: form_authenticity_token }
    end

    def destroy
      sign_out
      reset_session
      render json: { message: "Signed out" }
    end

    private

    def validate_credentials_shape
      credentials = params[:user]
      unless credentials.is_a?(ActionController::Parameters) && credentials[:email].is_a?(String) && credentials[:password].is_a?(String)
        render json: { error: "Invalid Email or password." }, status: :unauthorized
      end
    end

    # Devise rotates the session and CSRF state on successful authentication.
    def respond_with(user, _options = {})
      session[:authenticated_at] = Time.current.to_i
      render json: { user: user.slice(:id, :email, :name), csrfToken: form_authenticity_token }, status: :ok
    end
  end
end
