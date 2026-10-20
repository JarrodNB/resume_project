# Checks account email readiness without connecting to SMTP or printing credentials.
namespace :accounts do
  desc "Validate production account email configuration without sending email"
  task email_preflight: :environment do
    required = %w[WEB_APP_URL MAIL_FROM SMTP_HOST SMTP_DOMAIN SMTP_USERNAME SMTP_PASSWORD]
    missing = required.select { |key| ENV[key].blank? }
    abort "Missing account email configuration: #{missing.join(', ')}" if missing.any?
    uri = URI.parse(ENV.fetch("WEB_APP_URL"))
    abort "WEB_APP_URL must be an HTTPS origin" unless uri.scheme == "https" && uri.host.present? && uri.userinfo.nil? && uri.query.nil? && uri.fragment.nil? && [ "", "/" ].include?(uri.path)
    abort "MAIL_FROM must contain a valid address" unless Mail::Address.new(ENV.fetch("MAIL_FROM")).address.match?(Devise.email_regexp)
    abort "SMTP_PORT must be 587 or 2525 (STARTTLS required)" unless %w[587 2525].include?(ENV.fetch("SMTP_PORT", "587"))
    puts "Account email configuration ready (STARTTLS enabled; delivery not tested)."
  rescue URI::InvalidURIError, Mail::Field::ParseError
    abort "Invalid account email configuration"
  end
end
