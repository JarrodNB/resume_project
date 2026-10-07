# Description: Stops creating another career-library entry once the user is at the cap.
# A merge validates an unsaved copy without saving it, so the check runs on create only.
# Index:
#   - library_size_limit: declares the association, maximum, and message for this model
module LibrarySizeLimit
  extend ActiveSupport::Concern

  class_methods do
    # Rejects create when the user already has `maximum` rows in `association`.
    def library_size_limit(association, maximum, message)
      before_create do
        next if user.public_send(association).count < maximum

        errors.add(:base, message)
        throw :abort
      end
    end
  end
end
