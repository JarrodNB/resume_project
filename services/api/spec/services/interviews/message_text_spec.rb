# Saved spoken text must match how streamed speech joins it (`spoken_text` in
# services/ai/interviews/spoken_stream.py), or the browser cannot hand streamed speech over
# to the saved reply. services/ai/tests/test_spoken_text_contract.py checks the same cases.
require "rails_helper"

RSpec.describe Interviews::MessageText do
  {
    [ "You cut the wait.", "How did you measure it?" ] => "You cut the wait.\n\nHow did you measure it?",
    [ nil, "How did you measure it?" ] => "How did you measure it?",
    [ "Thanks for that", "Tell me about a conflict." ] => "Thanks for that\n\nTell me about a conflict."
  }.each do |(acknowledgement, content), spoken|
    it "joins #{acknowledgement.inspect} and the message as streamed speech does" do
      message = InterviewSessionMessage.new(acknowledgement: acknowledgement, content: content)
      expect(described_class.spoken_content(message)).to eq(spoken)
    end
  end
end
