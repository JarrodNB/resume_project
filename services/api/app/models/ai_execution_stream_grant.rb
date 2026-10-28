# One expiring, single-use authorization to observe a specific saved execution.
class AiExecutionStreamGrant < ApplicationRecord
  belongs_to :user
  validates :session_digest, :feature, :operation_id, :attempt_id, :token_digest, :expires_at, presence: true
  validates :claim_generation, numericality: { only_integer: true, greater_than: 0 }
end
