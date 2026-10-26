# Read shared interview preferences and compare wording consistently across both modes.
module InterviewPreferences
  module AvoidedQuestions
    MAX_QUESTIONS = 50
    MAX_QUESTION_CHARACTERS = 2000

    def self.digest(text)
      Digest::SHA256.hexdigest(text.downcase(:fold).scan(/[[:alnum:]_]+/).join(" "))
    end

    def self.snapshot(user)
      user.avoided_interview_questions.order(:created_at, :id).pluck(:question_text)
    end

    def self.saved?(user, text)
      user.avoided_interview_questions.exists?(text_digest: digest(text))
    end
  end
end
