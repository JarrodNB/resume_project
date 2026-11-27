# The same cases as test_turn_says_whether_this_answer_is_the_final_one_allowed in
# services/ai/tests/test_interview_input_reader.py, so the two final-answer rules stay in step.
require "rails_helper"

RSpec.describe Interviews::AcceptTurnService do
  { [ 0, 2 ] => false, [ 1, 2 ] => true, [ 1, 3 ] => false, [ 2, 3 ] => true }.each do |(accepted, cap), final|
    it "treats answer #{accepted + 1} of a #{cap}-answer question as final: #{final}" do
      expect(described_class.final_answer?(accepted_answer_count: accepted, answer_cap: cap)).to be(final)
    end
  end
end
