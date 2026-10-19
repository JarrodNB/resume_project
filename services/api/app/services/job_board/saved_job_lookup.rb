# Finds the current owner's saved copy without changing it. Search and import
# share URL identity so the create/open decision stays consistent.
require "uri"

module JobBoard
  class SavedJobLookup
    TRACKING_PARAMETERS = %w[fbclid gclid dclid msclkid mc_cid mc_eid].freeze

    # @param user [User] authenticated owner whose Jobs form this read-only snapshot
    def initialize(user:)
      jobs = user.jobs.order(:created_at, :id).to_a
      @by_source = {}
      @by_url = {}
      jobs.each do |job|
        @by_source[job.job_board_listing_id] ||= job if job.job_board_listing_id
        identity = normalized_url(job.url)
        @by_url[identity] ||= job if identity
      end
    end

    # @return [Job, nil] source match first, otherwise the oldest owned URL match
    def find(listing)
      @by_source[listing.id] || @by_url[normalized_url(listing.payload["application_url"])]
    end

    private

    def normalized_url(value)
      return if value.blank?
      uri = URI.parse(value)
      return unless %w[http https].include?(uri.scheme) && uri.host
      uri.fragment = nil
      if uri.query
        parameters = URI.decode_www_form(uri.query).reject { |key, _| key.downcase.start_with?("utm_") || TRACKING_PARAMETERS.include?(key.downcase) }
        uri.query = parameters.empty? ? nil : URI.encode_www_form(parameters)
      end
      uri.to_s
    rescue URI::InvalidURIError, ArgumentError
      nil
    end
  end
end
