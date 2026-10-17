# Description: Derived vector of one current saved interview question and answer.
# Index:
#   - interview_question: owning question, whose practice set determines user ownership
class InterviewQuestionEmbedding < ApplicationRecord
  belongs_to :interview_question
  self.filter_attributes += [ :embedding ]
  validates :content, :content_digest, :model, presence: true
end
