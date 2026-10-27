# Unit/service examples must not nudge a separately running AI process. Integration
# examples opt back into the real transport at their own controlled local HTTP seam.
RSpec.configure do |config|
  config.before do
    allow(AiExecutions::NudgeService).to receive(:call)
      .and_return(ServiceResult.new(success: false, value: nil, errors: [ "offline test transport" ]))
  end
end
