# Hides credentials, personal fields, and private interview execution content from
# parameter logs. GraphQL envelopes are opaque because inline literals and arbitrary
# variable names can contain the same private data. Restart the server after changing this filter list.

# Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
# Use this to limit dissemination of sensitive information.
# See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Rails.application.config.filter_parameters += [
  :query, :variables, :operations,
  :upload_url, :download_url, :playback_url, :checksum, :media_id, :session_digest,
  :observation_id, :attempt_id, :claim_generation, :recording_id, :model_history, :transcript, :reply, :acknowledgement, :authorization, :passw, :email, :secret, :token, :csrf, :cookie, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc
]
