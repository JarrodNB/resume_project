# Shared persistence keeps exact source text while deduplicating cosmetic wording changes.
require "rails_helper"

RSpec.describe InterviewPreferences::SaveAvoidedQuestionService do
  let(:user) { create(:user) }

  it "reuses normalized duplicates at capacity and explicitly rejects a new choice" do
    50.times do |index|
      expect(described_class.call(user: user, question_text: "Question #{index}?")).to be_success
    end
    expect(described_class.call(user: user, question_text: "  QUESTION 0! ")).to be_success
    result = described_class.call(user: user, question_text: "A different question?")
    expect(result).not_to be_success
    expect(result.errors).to include(/limit of 50/)
    expect(user.avoided_interview_questions.count).to eq(50)
    expect(user.avoided_interview_questions.order(:created_at).first.question_text).to eq("Question 0?")
  end

  it "rejects blank and oversized questions without clipping their text" do
    [ " ", "x" * 2001 ].each do |text|
      result = described_class.call(user: user, question_text: text)
      expect(result).not_to be_success
      expect(result.errors).to include(/2,000-character/)
    end
    expect(user.avoided_interview_questions).to be_empty
  end
end
