# Credentialed browser requests are allowed only from explicit web origins.
origins = ENV.fetch("CORS_ORIGINS", "http://localhost:5173").split(",").map(&:strip)
if origins.any? { |origin| !origin.match?(%r{\Ahttps?://[^/\s*]+\z}) }
  raise "CORS_ORIGINS must contain explicit HTTP(S) origins"
end
Rails.application.config.action_cable.allowed_request_origins = origins
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*origins)
    resource "*", headers: :any, credentials: true,
      methods: [ :get, :post, :put, :patch, :delete, :options, :head ]
  end
end
