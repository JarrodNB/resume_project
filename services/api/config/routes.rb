# HTTP routes. Auth uses browser sessions and public domain data uses GraphQL. Private
# interview execution callbacks authenticate a separate service credential.
# Index:
#   - GET /auth/session, POST /auth/sign_up, /auth/sign_in, DELETE /auth/sign_out
#   - POST /auth/confirmation (resend), /auth/confirmation/verify (consume token)
#   - POST/PUT /auth/password (request/reset), PATCH /auth/password/change
#   - POST /graphql
#   - GET /up: health check
Rails.application.routes.draw do
  mount LetterOpenerWeb::Engine, at: "/letter_opener" if Rails.env.development?

  # Registrations are skipped so Devise's account edit/update/delete routes don't exist; only
  # sign-up is added back. Devise owns the sign-in/sign-out routes.
  devise_for :users,
             path: "auth",
             path_names: { sign_in: "sign_in", sign_out: "sign_out" },
             controllers: { sessions: "auth/sessions" },
             skip: [ :registrations, :confirmations, :passwords ],
             defaults: { format: :json }

  devise_scope :user do
    get "auth/session", to: "auth/sessions#show", defaults: { format: :json }
    post "auth/sign_up", to: "auth/registrations#create", defaults: { format: :json }
    post "auth/confirmation", to: "auth/confirmations#create", defaults: { format: :json }
    post "auth/confirmation/verify", to: "auth/confirmations#verify", defaults: { format: :json }
    post "auth/password", to: "auth/passwords#create", defaults: { format: :json }
    put "auth/password", to: "auth/passwords#update", defaults: { format: :json }
    patch "auth/password/change", to: "auth/passwords#change", defaults: { format: :json }
  end

  namespace :internal do
    get "chat/operations/:id", to: "chat#status"
    %w[claim heartbeat start_provider usage accept fail].each do |callback|
      post "chat/operations/:id/#{callback}", to: "chat##{callback}"
    end
    post "execution_streams/:action_name", to: "execution_streams#update", constraints: { action_name: /redeem|check/ }
    post "interviews/transcriptions/:action_name", to: "interview_transcriptions#update", constraints: { action_name: /redeem|finish|fail/ }
    post "interviews/feedback/:id/claim", to: "interviews#claim_feedback"
    post "interviews/references/:id/claim", to: "interviews#claim_references"
    post "interviews/clarifications/:id/claim", to: "interviews#claim_clarification"
    get "interviews/operations/:id", to: "interviews#status"
    %w[claim heartbeat accept accept_transcription accept_preparation fail usage retry start_provider recording reserve_audio register_audio complete_audio].each do |callback|
      post "interviews/operations/:id/#{callback}", to: "interviews##{callback}"
    end
  end

  post "/graphql", to: "graphql#execute"

  get "up" => "rails/health#show", as: :rails_health_check
end
