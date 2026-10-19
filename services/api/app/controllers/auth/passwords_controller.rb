# Adapts recovery and current-password changes to JSON; every write requires Rails CSRF.
module Auth
  class PasswordsController < ApplicationController
    before_action :authenticate_user!, only: :change

    def change
      fields = params.expect(user: [ :current_password, :password, :password_confirmation ])
      result = Accounts::ChangePasswordService.call(user: current_user, current_password: fields[:current_password], password: fields[:password], password_confirmation: fields[:password_confirmation])
      if result.success?
        sign_out
        reset_session
        render json: { message: "Password changed. Sign in with your new password." }
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    def update
      fields = params.expect(user: [ :reset_password_token, :password, :password_confirmation ])
      result = Accounts::ResetPasswordService.call(token: fields[:reset_password_token], password: fields[:password], password_confirmation: fields[:password_confirmation])
      if result.success?
        # Preserve an unrelated signed-in account using the public recovery page.
        if current_user&.id == result.value.id
          sign_out
          reset_session
        end
        render json: { message: "Password reset. Sign in with your new password." }
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    def create
      email = params.expect(user: [ :email ])[:email]
      unless email.is_a?(String) && email.bytesize <= 254 && email.match?(Devise.email_regexp) && !email.include?("\0")
        render json: { errors: [ "Enter a valid email address" ] }, status: :unprocessable_content
        return
      end
      Accounts::RequestPasswordResetService.call(email: email)
      render json: { message: Accounts::RequestPasswordResetService::MESSAGE }, status: :accepted
    end
  end
end
