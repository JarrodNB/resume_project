# Adapts confirmation requests; GET never consumes email links.
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
        render json: { message: "Email verified. You can now sign in." }
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end
  end
end
