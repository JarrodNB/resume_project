# Description: Decides whether a saved link is a safe web address: absolute http or https, with a
# host, no whitespace or control characters, and no username or password in it. Addresses with
# non-English letters are fine. Used wherever a link the user did not type themselves is saved,
# because the app opens those links and puts them in exported resumes.
class WebAddress
  # @param value [Object] the link text; anything that is not a String is not a web address
  def self.valid?(value)
    return false unless value.is_a?(String) && value.match?(/\Ahttps?:\/\/[^\s\p{Cntrl}]+\z/i)

    uri = URI.parse(value.gsub(/[^\x00-\x7F]/) { |character| CGI.escape(character) })
    uri.is_a?(URI::HTTP) && uri.host.present? && uri.userinfo.nil?
  rescue URI::InvalidURIError
    false
  end
end
