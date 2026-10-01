# Description: HTTP routes. Auth is REST (Devise + JWT); everything else is GraphQL.
# Index:
#   - POST /auth/sign_up, /auth/sign_in (returns JWT in Authorization header), DELETE /auth/sign_out
#   - POST /graphql
#   - GET /up: health check
Rails.application.routes.draw do
  devise_for :users,
             path: "auth",
             path_names: { sign_in: "sign_in", sign_out: "sign_out", registration: "sign_up" },
             controllers: { sessions: "auth/sessions", registrations: "auth/registrations" },
             defaults: { format: :json }

  post "/graphql", to: "graphql#execute"

  get "up" => "rails/health#show", as: :rails_health_check
end
