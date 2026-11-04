# Keeps specs off Cloudflare's network: sign-up's bot check passes unless a spec opts out with
# :real_bot_challenge or stubs its own result.
RSpec.configure do |config|
  config.before do |example|
    next if example.metadata[:real_bot_challenge]
    allow(Accounts::VerifyBotChallengeService).to receive(:call).and_return(ServiceResult.new(success: true, value: nil, errors: []))
  end
end
