# Validates signup before hiding duplicates. Devise owns passwords and tokens.
module Accounts
  class RegisterAccountService < ApplicationService
    MESSAGE = "If this address can be registered, a verification email will arrive shortly. Check spam, or request another email."

    def initialize(attributes:)
      @attributes = attributes
    end

    # Creates an unconfirmed account and attempts one delivery, without signing in.
    def call
      email = @attributes[:email]
      return failure([ "Email is invalid" ]) unless email.is_a?(String) && !email.include?("\0") && email.bytesize <= 254
      user = User.new(@attributes)
      user.skip_confirmation_notification!
      user.valid?
      duplicate = user.errors.of_kind?(:email, :taken)
      user.errors.delete(:email, :taken) if duplicate
      return failure(user.errors) if user.errors.any?
      return success if duplicate
      user.save!
      ConfirmAccountService.call(email: user.email)
      success
    rescue ActiveRecord::RecordNotUnique
      success # A concurrent registration won; never replace its credentials.
    rescue ActiveRecord::RecordInvalid => error
      if error.record.errors.all? { |entry| entry.attribute == :email && entry.type == :taken }
        success
      else
        failure(error.record.errors)
      end
    end
  end
end
