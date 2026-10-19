# Built-in mail delivery: local files in development, SMTP in production, no provider calls at boot.
Rails.application.configure do
  # Bulk queue INSERT statements inline serialized tokens, bypassing bind filters.
  # A separate INFO logger keeps SQL out even when application debug logging is enabled.
  config.active_record.logger = ActiveSupport::TaggedLogging.new(ActiveSupport::Logger.new($stdout, level: Logger::INFO))
  config.action_mailer.raise_delivery_errors = true
  # Rails' mail log subscriber uses Base.logger, including message bodies at debug level.
  config.action_mailer.logger = nil
  config.action_mailer.delivery_method = Rails.env.production? ? :smtp : (Rails.env.test? ? :test : :file)
  config.action_mailer.file_settings = { location: Rails.root.join("tmp", "mails") }
  config.action_mailer.smtp_settings = {
    address: ENV["SMTP_HOST"], port: ENV.fetch("SMTP_PORT", "587").to_i,
    user_name: ENV["SMTP_USERNAME"], password: ENV["SMTP_PASSWORD"],
    domain: ENV["SMTP_DOMAIN"], authentication: :plain, enable_starttls: true, enable_starttls_auto: false,
    ssl: false, open_timeout: 5, read_timeout: 5
  }
  config.action_mailer.show_previews = Rails.env.development?
  config.action_mailer.preview_paths = [ Rails.root.join("spec/mailers/previews") ]
end

# Defense in depth for SQL paths that use bind parameters.
ActiveSupport.on_load(:active_record) { self.filter_attributes += [ :arguments ] }
