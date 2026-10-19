# Accepts registration without a session or disclosure of duplicate accounts.
module Auth
  class RegistrationsController < ApplicationController
    def create
      result = Accounts::RegisterAccountService.call(attributes: params.expect(user: [ :name, :email, :password ]))
      if result.success?
        render json: { message: Accounts::RegisterAccountService::MESSAGE }, status: :accepted
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end
  end
end
