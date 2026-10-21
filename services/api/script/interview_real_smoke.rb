# Runs the complete synthetic HTTP-provider interview against real local services.
# Use the standalone full-session shell check for process kills and speech-only recovery too.
raise "Synthetic check only" unless Rails.env.development? && ENV["INTERVIEW_SYNTHETIC_PROVIDER_CHECK"] == "true"
ENV["CHECK_RUN_ID"] = "smoke-#{SecureRandom.hex(8)}"
%w[setup ready begin full].each do |phase|
  ENV["CHECK_PHASE"] = phase
  load Rails.root.join("script/interview_full_session_check.rb")
end
