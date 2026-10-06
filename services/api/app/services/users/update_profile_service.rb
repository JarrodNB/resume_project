# Description: Updates the signed-in user's career-library profile (name, contact details,
# links, summary). Blank strings are cleared. Sign-in email, password, and AI limits are not
# attributes of this service. The summary is read live by the AI service, so this does not
# queue an embedding sync.
# Index:
#   - call: applies the attributes; returns the user, or validation errors
module Users
  class UpdateProfileService < ApplicationService
    STRING_FIELDS = %i[name contact_email phone location summary].freeze

    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes
    end

    # Applies the profile attributes.
    def call
      @user.update(normalized_attributes) ? success(@user) : failure(@user.errors)
    end

    private

    # Turns blank strings into nil and drops blank links. Omitted keys are left unchanged.
    def normalized_attributes
      @attributes.to_h.symbolize_keys.to_h do |key, value|
        [ key, normalize(key, value) ]
      end
    end

    # Clears a blank string field, or drops blank entries from links.
    def normalize(key, value)
      return compact_links(value) if key == :links
      return value.strip.presence if STRING_FIELDS.include?(key) && value.is_a?(String)

      value
    end

    # Keeps only links that have text. An empty list clears the column (it cannot be nil).
    def compact_links(value)
      Array(value).filter_map { |link| link.to_s.strip.presence }
    end
  end
end
