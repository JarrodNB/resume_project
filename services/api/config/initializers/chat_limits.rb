# Chat limits are authoritative Rails settings, exposed to the composer and copied into execution snapshots.
module ChatLimits
  MAX_INPUT_CHARACTERS = Integer(ENV.fetch("CHAT_MAX_INPUT_CHARACTERS", "10000"))
  SUMMARIZE_EVERY_USER_MESSAGES = Integer(ENV.fetch("CHAT_SUMMARIZE_EVERY_USER_MESSAGES", "20"))
  unless MAX_INPUT_CHARACTERS.between?(1, 80_000) && SUMMARIZE_EVERY_USER_MESSAGES.positive?
    raise ArgumentError, "Chat limits must be positive, and CHAT_MAX_INPUT_CHARACTERS must not exceed 80000"
  end
end
