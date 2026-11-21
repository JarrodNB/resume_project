# Sends Devise mail (and the trial-ending notice) using a trusted web URL, keeping tokens out of server URL logs.
class AccountMailer < Devise::Mailer
  self.logger = nil # Debug body logging would expose account email tokens.
  self.delivery_job = AccountMailDeliveryJob
  layout "account_mailer"

  def confirmation_instructions(record, token, opts = {})
    @confirmation_url = "#{ENV.fetch('WEB_APP_URL', 'http://localhost:5173').delete_suffix('/')}/verify-email#confirmation_token=#{ERB::Util.url_encode(token)}"
    super(record, token, opts.reverse_merge(subject: "Verify your Careerdrafter email"))
  end

  def reset_password_instructions(record, token, opts = {})
    @reset_password_url = "#{ENV.fetch('WEB_APP_URL', 'http://localhost:5173').delete_suffix('/')}/reset-password#reset_password_token=#{ERB::Util.url_encode(token)}"
    super(record, token, opts.reverse_merge(subject: "Reset your Careerdrafter password"))
  end

  # Heads-up sent shortly before a free trial ends (the email gives the UTC end date). Not a Devise mail, so it builds its own message.
  def trial_ending(user)
    @trial_ends_on = user.trial_ends_at.utc.strftime("%A, %B %-d")
    @billing_url = Billing::BillingPage.url
    mail(to: user.email, from: Devise.mailer_sender, subject: "Your Careerdrafter free trial ends soon")
  end
end
