# Description: One billed embedding API batch, retained when library entries are deleted.
# Index:
#   - user: account charged for the request
class EmbeddingUsage < ApplicationRecord
  belongs_to :user

  validates :model, presence: true
  validates :input_tokens, :cost_microdollars, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
