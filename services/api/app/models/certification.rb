# Description: A user-owned credential kept independently from formal education.
# Index: user association; required name; text and library count validations
class Certification < ApplicationRecord
  include ScreenedFields
  screenable_fields %w[name issuer credential_id credential_url description]
  include LibrarySizeLimit

  belongs_to :user

  library_size_limit :certifications, TextLimits::MAX_CERTIFICATIONS,
    "You can save up to #{TextLimits::MAX_CERTIFICATIONS} certifications"

  validates :issued_date_precision, :expiry_date_precision, inclusion: { in: %w[year month day] }
  validates :name, presence: true
  validates :name, :issuer, :credential_id, :credential_url, length: { maximum: TextLimits::SHORT }
  validates :description, length: { maximum: TextLimits::PROSE }
end
