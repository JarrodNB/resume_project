# Copies a public listing into a private Job snapshot. Deduplication happens under
# the owner's row lock; refreshing provider data never rewrites a saved application.
require "uri"

module JobBoard
  class ImportListingService < ApplicationService
    LEFT_OUT_WARNING = "Part of this posting was too long to save, so the extra text was left out.".freeze
    TRACKING_PARAMETERS = %w[fbclid gclid dclid msclkid mc_cid mc_eid].freeze

    # @param user [User] authenticated owner
    # @param listing [JobBoardListing] shared provider snapshot
    def initialize(user:, listing:)
      @user, @listing = user, listing
      @warnings = []
    end

    # @return [ServiceResult] value contains :job and :warnings (omitted content).
    # Makes no provider requests and schedules no AI tasks.
    def call
      @user.with_lock do
        job = @user.jobs.find_by(job_board_listing_id: @listing.id) || matching_url_job
        if job
          job.update!(job_board_listing: @listing) unless job.job_board_listing_id
        else
          job = @user.jobs.create!(attributes.merge(job_board_listing: @listing))
        end
        success(job: job, warnings: @warnings)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    def matching_url_job
      identity = normalized_url(@listing.payload["application_url"])
      return unless identity

      @user.jobs.where.not(url: [ nil, "" ]).order(:created_at, :id).detect { |job| normalized_url(job.url) == identity }
    end

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

    def attributes
      payload = @listing.payload
      description = ListingDescription.new(payload["description"].to_s)
      fields = { title: shorten(payload["title"], TextLimits::SHORT), company: shorten(payload.dig("company", "name"), TextLimits::SHORT).presence,
                 location: shorten(payload["location"], TextLimits::SHORT), description: shorten(description.text, TextLimits::JOB_DESCRIPTION), url: application_url(payload["application_url"]) }
      description.sections.each do |key, bullets|
        kept = bullets.select { |bullet| bullet.length <= TextLimits::BULLET }.first(TextLimits::MAX_REQUIREMENTS)
        warn_omitted if kept.size != bullets.size
        fields[key] = kept
      end
      fields
    end

    def application_url(value)
      return value if value.nil? || value.length <= TextLimits::SHORT
      warn_omitted
      nil
    end

    def shorten(value, limit)
      return value if value.nil? || value.length <= limit
      warn_omitted
      value.first(limit)
    end

    def warn_omitted
      @warnings |= [ LEFT_OUT_WARNING ]
    end
  end
end
