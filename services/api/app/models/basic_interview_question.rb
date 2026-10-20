# A prepared question and its accepted execution history, separate from public dialogue.
class BasicInterviewQuestion < ApplicationRecord
  belongs_to :basic_interview
  has_many :messages, class_name: "BasicInterviewMessage", foreign_key: :question_id, dependent: :destroy
  validates :content, presence: true
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, uniqueness: { scope: :basic_interview_id }
  validates :accepted_answer_count, inclusion: { in: 0..2 }
  validates :history_version, inclusion: { in: [ 1 ] }
end
