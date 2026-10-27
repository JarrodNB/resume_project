# A durable receipt or unknown-cost marker for one user-owned background embedding call.
# Kept independently of derived vectors so deletion or failed persistence retains its bill.
class AiEmbeddingRequest < ApplicationRecord
  belongs_to :user
  validates :purpose, inclusion: { in: %w[career_library interview_question] }
end
