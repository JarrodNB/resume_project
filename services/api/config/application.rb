# Description: Rails application config. API-only, UUID primary keys, RSpec generators,
# ActionCable origins (WebSocket at /cable, auto-mounted by Rails).
require_relative "boot"

require "rails/all"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module Api
  class Application < Rails::Application
    config.active_record.query_log_tags_enabled = true
    config.active_record.query_log_tags = [
      # Rails query log tags:
      :application, :controller, :action, :job,
      # GraphQL-Ruby query log tags:
      current_graphql_operation: -> { GraphQL::Current.operation_name },
      current_graphql_field: -> { GraphQL::Current.field&.path },
      current_dataloader_source: -> { GraphQL::Current.dataloader_source_class }
    ]
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1

    # Use durable jobs in development and production. Solid Queue must inherit the
    # primary connection pool so transactional jobs commit with domain writes;
    # a separate connects_to declaration would silently break that guarantee.
    config.active_job.queue_adapter = :solid_queue

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # config.time_zone = "Central Time (US & Canada)"
    # config.eager_load_paths << Rails.root.join("extras")

    # Only loads a smaller set of middleware suitable for API only apps.
    # Middleware like session, flash, cookies can be added back manually.
    # Skip views, helpers and assets when generating a new resource.
    config.api_only = true

    config.middleware.use ActionDispatch::Cookies
    config.session_store :active_record_store, key: "_careergrind_session", expire_after: 1.day,
      httponly: true, secure: Rails.env.production?, same_site: :lax, secure_session_only: true
    config.middleware.use config.session_store, config.session_options

    # WebSocket origins match the CORS origins (see config/initializers/cors.rb).
    config.action_cable.allowed_request_origins = ENV.fetch("CORS_ORIGINS", "http://localhost:5173").split(",")

    config.generators do |generator|
      generator.orm :active_record, primary_key_type: :uuid
      generator.test_framework :rspec
    end
  end
end
