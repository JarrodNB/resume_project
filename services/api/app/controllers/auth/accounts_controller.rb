# Lets a signed-in user permanently delete their own account after re-entering their password.
# Requires Rails CSRF like every other account write, and signs this browser out on success.
module Auth
  class AccountsController < ApplicationController
    before_action :authenticate_user!

    def destroy
      current_password = params.expect(user: [ :current_password ])[:current_password]
      result = Accounts::DeleteAccountService.call(user: current_user, current_password: current_password)
      if result.success?
        sign_out
        reset_session
        render json: { message: "Your account and its data have been deleted." }
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end
  end
end
