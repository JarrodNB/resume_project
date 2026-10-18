# A successful check of exact privacy-protected source content under one screening policy.
# Decisions belong to an account; they contain no original source text.
class ScreeningDecision < ApplicationRecord
  belongs_to :user
  validates :content_digest, :policy_identity, presence: true, format: { with: /\A[0-9a-f]{64}\z/ }
end
