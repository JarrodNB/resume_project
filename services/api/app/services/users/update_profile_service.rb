# Reloads under the user lock so summary edits invalidate newly earned screening approvals.
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
      @user.with_lock do
        @user.assign_attributes(normalized_attributes)
        @user.discard_changed_screened_fields
        @user.save ? success(@user) : failure(@user.errors)
      end
    end

    private

    # Turns blank strings into nil and drops blank links. Omitted keys are left unchanged.
    def normalized_attributes
      @attributes.to_h.symbolize_keys.to_h do |key, value|
        next [ key, compact_links(value) ] if key == :links

        value = value.strip.presence if STRING_FIELDS.include?(key) && value.is_a?(String)
        [ key, value ]
      end
    end

    # Keeps links with both a label and URL. An empty list clears the column.
    def compact_links(value)
      Array(value).filter_map do |link|
        attributes = link.respond_to?(:to_h) ? link.to_h.stringify_keys : { "label" => link.to_s, "url" => link.to_s }
        label = attributes["label"].to_s.strip.presence
        url = attributes["url"].to_s.strip.presence
        { "label" => label, "url" => url } if label && url
      end
    end
  end
end
