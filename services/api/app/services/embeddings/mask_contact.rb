# Description: Replaces a user's known name, contact email, and phone with placeholders
# before that text is sent to the embeddings API. The stored library text stays original.
# The same placeholders («name», «email», «phone») are used by the AI worker, so a search
# query and a library row that contain the same contact still meet.
# Index:
#   - mask: the text with known contact replaced
module Embeddings
  module MaskContact
    module_function

    # Returns `text` with this user's known contact replaced. Blank values are left out.
    def mask(text, user)
      pairs_for(user).reduce(text.to_s) do |masked, (secret, placeholder)|
        masked.gsub(/(?<!\w)#{Regexp.escape(secret)}(?!\w)/i, placeholder)
      end
    end

    # [secret, placeholder] pairs, longest secret first, so a full name is replaced
    # before a shorter value that sits inside it.
    def pairs_for(user)
      pairs = []
      add(pairs, "name", user.name) { |value| value.match?(/[[:alpha:]]/) && value.length >= 2 }
      add(pairs, "email", user.contact_email) { |value| value.include?("@") }
      add(pairs, "phone", user.phone) { |value| value.match?(/\d/) && value.length >= 7 }
      pairs.sort_by { |secret, _placeholder| -secret.length }
    end
    private_class_method :pairs_for

    # Appends one usable value. A blank or rejected value is skipped.
    def add(pairs, label, value)
      cleaned = value.to_s.strip
      return if cleaned.empty? || cleaned.include?("«") || !yield(cleaned)

      pairs << [ cleaned, "«#{label}»" ]
    end
    private_class_method :add
  end
end
