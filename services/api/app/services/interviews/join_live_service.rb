# Lets the owner open the LiveKit room for a live interview. The first join moves a ready
# interview to active without saving an opening (the live agent saves it when spoken).
# It creates or reuses the session's open live connection and signs a short join token that
# also asks LiveKit to dispatch the live interviewer agent. A new room needs at least 5 live
# minutes left (Interviews::LiveAllowance); a rejoin of the open room does not. No LiveKit call happens here.
module Interviews
  class JoinLiveService < ApplicationService
    # The LiveKit agent name the live interviewer worker registers under.
    AGENT_NAME = "careerdrafter-live-interviewer".freeze
    TOKEN_TTL = 10.minutes
    CONFIGURATION = %w[LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET].freeze

    def initialize(interview:)
      @interview = interview
    end

    # @return [ServiceResult<Hash>] `{ url:, token:, room_name:, expires_at: }`; the token lets
    #   identity `user-<id>` join only this room and carries agent dispatch metadata with only
    #   the session and connection IDs
    def call
      missing = CONFIGURATION.select { |name| ENV[name].blank? }
      return failure("Live interviews are not configured. Set #{missing.join(', ')}.") if missing.any?
      @interview.user.with_lock do
        @interview.lock!
        next failure("Interview expired") if @interview.expired? || @interview.expires_at <= Time.current
        next failure("This interview is not a live interview") unless @interview.conversation_live?
        next failure("Interview has ended") if @interview.completed? || @interview.abandoned?
        next failure("Interview is not ready") unless @interview.ready? || @interview.active?
        next failure("Prepared questions unavailable") unless @interview.questions.exists?
        connection = @interview.live_connections.open.first
        # A rejoin reuses its open connection; only a new room needs 5 live minutes.
        unless connection
          refusal = LiveAllowance.start_refusal(@interview.user)
          next failure(refusal, code: :live_allowance_low) if refusal
        end
        connection ||= @interview.live_connections.create!(room_name: "interview-#{@interview.id}-#{SecureRandom.urlsafe_base64(16)}")
        @interview.update!(status: "active", revision: @interview.revision + 1) if @interview.ready?
        success(join_details(connection))
      end
    end

    private

    def join_details(connection)
      expires_at = Time.current + TOKEN_TTL
      token = LiveKit::AccessToken.new(api_key: ENV.fetch("LIVEKIT_API_KEY"), api_secret: ENV.fetch("LIVEKIT_API_SECRET"),
        identity: "user-#{@interview.user_id}", ttl: TOKEN_TTL.to_i)
      token.video_grant = LiveKit::VideoGrant.new(roomJoin: true, room: connection.room_name)
      metadata = { interview_session_id: @interview.id, live_connection_id: connection.id }.to_json
      token.room_config = LiveKit::Proto::RoomConfiguration.new(agents: [ LiveKit::Proto::RoomAgentDispatch.new(agent_name: AGENT_NAME, metadata: metadata) ])
      { url: ENV.fetch("LIVEKIT_URL"), token: token.to_jwt, room_name: connection.room_name, expires_at: expires_at }
    end
  end
end
