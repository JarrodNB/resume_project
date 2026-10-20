# Rails-owned spoken demo session. Its services change dialogue and progress together;
# the existing written practice records remain independent.
class BasicInterview < ApplicationRecord
  STATUSES = %w[active completed expired].freeze
  belongs_to :user
  has_many :questions, -> { order(:position) }, class_name: "BasicInterviewQuestion", dependent: :destroy
  has_many :messages, -> { order(:position) }, class_name: "BasicInterviewMessage", dependent: :destroy
  has_many :operations, class_name: "BasicInterviewOperation", dependent: :destroy
  enum :status, STATUSES.index_with(&:itself), validate: true
  validates :expires_at, presence: true
  validates :revision, :current_question_position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :answer_cap, inclusion: { in: 1..2 }
end
