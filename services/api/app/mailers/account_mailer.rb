# Sends Devise mail using a trusted web URL, keeping tokens out of server URL logs.
class AccountMailer < Devise::Mailer
  self.logger = nil # Debug body logging would expose account email tokens.
  self.delivery_job = AccountMailDeliveryJob
  layout "account_mailer"

  def confirmation_instructions(record, token, opts = {})
    @confirmation_url = "#{ENV.fetch('WEB_APP_URL', 'http://localhost:5173').delete_suffix('/')}/verify-email#confirmation_token=#{ERB::Util.url_encode(token)}"
    super(record, token, opts.reverse_merge(subject: "Verify your Careergrind email"))
  end

  def reset_password_instructions(record, token, opts = {})
    @reset_password_url = "#{ENV.fetch('WEB_APP_URL', 'http://localhost:5173').delete_suffix('/')}/reset-password#reset_password_token=#{ERB::Util.url_encode(token)}"
    super(record, token, opts.reverse_merge(subject: "Reset your Careergrind password"))
  end
end
