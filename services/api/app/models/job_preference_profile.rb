# One private next-job preference draft and its last explicitly confirmed snapshot.
class JobPreferenceProfile < ApplicationRecord
  belongs_to :user
  validates :user_id, uniqueness: true
  validates :version, :confirmed_revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
