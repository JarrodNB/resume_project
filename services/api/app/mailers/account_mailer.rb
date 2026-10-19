# Sends Devise mail using a trusted web URL, keeping tokens out of server URL logs.
class AccountMailer < Devise::Mailer
  self.logger = nil # Debug body logging would expose confirmation tokens.
  self.delivery_job = AccountMailDeliveryJob

  def confirmation_instructions(record, token, opts = {})
    @confirmation_url = "#{ENV.fetch('WEB_APP_URL', 'http://localhost:5173').delete_suffix('/')}/verify-email#confirmation_token=#{ERB::Util.url_encode(token)}"
    super
  end
end
