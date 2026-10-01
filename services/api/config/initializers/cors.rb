# Description: CORS for the web app. Origins come from CORS_ORIGINS (comma-separated), defaulting
# to the local Vite dev server. Exposes the Authorization header so the client can read the JWT.
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*ENV.fetch("CORS_ORIGINS", "http://localhost:5173").split(","))

    resource "*",
      headers: :any,
      expose: [ "Authorization" ],
      methods: [ :get, :post, :put, :patch, :delete, :options, :head ]
  end
end
