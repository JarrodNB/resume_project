# Description: HTTP routes. Auth uses Devise browser sessions; domain data uses GraphQL.
# Index:
#   - GET /auth/session, POST /auth/sign_up, /auth/sign_in, DELETE /auth/sign_out
#   - POST /graphql
#   - GET /up: health check
Rails.application.routes.draw do
  # Registrations are skipped so Devise's account edit/update/delete routes don't exist; only
  # sign-up is added back. Devise owns the sign-in/sign-out routes.
  devise_for :users,
             path: "auth",
             path_names: { sign_in: "sign_in", sign_out: "sign_out" },
             controllers: { sessions: "auth/sessions" },
             skip: [ :registrations ],
             defaults: { format: :json }

  devise_scope :user do
    get "auth/session", to: "auth/sessions#show", defaults: { format: :json }
    post "auth/sign_up", to: "auth/registrations#create", defaults: { format: :json }
  end

  post "/graphql", to: "graphql#execute"

  get "up" => "rails/health#show", as: :rails_health_check
end
