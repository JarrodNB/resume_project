# Adapts confirmation requests; GET never consumes email links.
# A successful verify returns the confirmed email (only to whoever holds the one-time token) so the
# sign-in form can be filled in; it does not create a session.
module Auth
  class ConfirmationsController < ApplicationController
    def create
      email = params.expect(user: [ :email ])[:email]
      unless email.is_a?(String) && email.bytesize <= 254 && email.match?(Devise.email_regexp) && !email.include?("\0")
        render json: { errors: [ "Enter a valid email address" ] }, status: :unprocessable_content
        return
      end
      Accounts::ConfirmAccountService.call(email: email)
      render json: { message: Accounts::RegisterAccountService::MESSAGE }, status: :accepted
    end

    def verify
      result = Accounts::ConfirmAccountService.call(token: params[:confirmation_token])
      if result.success?
        render json: { message: "Email verified. You can now sign in.", email: result.value }
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end
  end
end
