# Checks for bots first, so duplicates look the same and bots cost no password hashing.
# Validates signup before hiding duplicates. Devise owns passwords and tokens.
# Refuses throwaway email domains before looking up the account, so the answer can't reveal one.
# A domain over its daily cap gets the same 202 as a duplicate, with no account and no email.
module Accounts
  class RegisterAccountService < ApplicationService
    MESSAGE = "If this address can be registered, a verification email will arrive shortly. Check spam, or request another email."
    DISPOSABLE_EMAIL = "Please use a permanent email address. Temporary email services can't be used to sign up."

    def initialize(attributes:, challenge_token:, client_ip: nil)
      @attributes, @challenge_token, @client_ip = attributes, challenge_token, client_ip
    end

    # Creates an unconfirmed account and attempts one delivery, without signing in.
    def call
      challenge = VerifyBotChallengeService.call(token: @challenge_token, client_ip: @client_ip)
      return challenge unless challenge.success?
      email = @attributes[:email]
      return failure([ "Email is invalid" ]) unless email.is_a?(String) && !email.include?("\0") && email.bytesize <= 254
      return failure([ DISPOSABLE_EMAIL ]) if SignUpEmailRules.disposable?(email)
      user = User.new(@attributes)
      user.skip_confirmation_notification!
      user.valid?
      duplicate = user.errors.of_kind?(:email, :taken)
      user.errors.delete(:email, :taken) if duplicate
      return failure(user.errors) if user.errors.any?
      return success if duplicate || SignUpEmailRules.domain_limit_reached?(user.email)
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
