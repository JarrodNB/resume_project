# Search the shared provider catalogue with a 24-hour page cache. A database lock
# coordinates simultaneous misses across Rails processes; failed refreshes keep old data.
require "digest"

module JobBoard
  class SearchCatalogueService < ApplicationService
    NORMALIZATION_REVISION = 1

    # @param keyword [String] a provider search phrase; case and punctuation are preserved
    # @param remote_only [Boolean] require remote listings
    # @param cursor [String, nil] exact opaque continuation token; nil is the first page
    # @param provider [#call] normalized list boundary (no per-listing detail calls)
    # @return [ServiceResult] success value: {listings: Array<JobBoardListing>,
    #   next_cursor: String | nil, retrieved_at: Time, stale: Boolean, errors: Array<String>}.
    #   Stale fallback is a success with errors; failure without a cached page has no value.
    #   No user data or Jobs are read or written. Holds one DB connection during HTTP.
    def initialize(keyword:, remote_only: false, cursor: nil, provider: SearchCleanJobDataService)
      @keyword, @remote_only, @cursor, @provider = keyword, remote_only, cursor, provider
    end

    def call
      return failure("Enter a keyword of 1 to 200 characters.") unless valid_text?(@keyword, 200)
      return failure("Invalid search filters.") unless [ true, false ].include?(@remote_only) && (@cursor.nil? || valid_text?(@cursor, 4096))

      @keyword = @keyword.strip.gsub(/ +/, " ")
      @query_digest = Digest::SHA256.hexdigest(JSON.generate([ NORMALIZATION_REVISION, @keyword, @remote_only, @cursor ]))
      JobBoardSearchPage.transaction do
        # A transaction-scoped advisory lock also protects the first miss (no row exists).
        # Signed 64-bit SHA prefix is stable across Ruby processes; collisions only serialize.
        lock_id = @query_digest[0, 16].to_i(16)
        lock_id -= 2**64 if lock_id >= 2**63
        JobBoardSearchPage.connection.execute("SELECT pg_advisory_xact_lock(#{lock_id})")
        page = JobBoardSearchPage.find_by(query_digest: @query_digest)
        if page && page.retrieved_at > 24.hours.ago
          page_result(page)
        else
          refresh(page)
        end
      end
    end

    private

    def valid_text?(value, limit)
      value.is_a?(String) && value.valid_encoding? && !value.strip.empty? && value.length <= limit && !value.match?(/[[:cntrl:]]/)
    end

    def refresh(page)
      result = @provider.call(keyword: @keyword, remote_only: @remote_only, cursor: @cursor)
      return page ? page_result(page, errors: result.errors) : failure(result.errors) unless result.success?

      now = Time.current
      # Stable ID order avoids deadlocks between searches whose results overlap.
      listings = result.value[:listings].uniq { |listing| listing.fetch("id") }
      unless listings.empty?
        JobBoardListing.upsert_all(listings.sort_by { |listing| listing.fetch("id") }.map { |listing|
          { provider_id: listing.fetch("id"), payload: listing, created_at: now, updated_at: now }
        }, unique_by: :provider_id, update_only: [ :payload, :updated_at ], record_timestamps: false)
      end
      ids = JobBoardListing.where(provider_id: listings.map { |listing| listing.fetch("id") }).pluck(:provider_id, :id).to_h
      page ||= JobBoardSearchPage.new(query_digest: @query_digest, keyword: @keyword, remote_only: @remote_only, cursor: @cursor)
      page.update!(listing_ids: listings.map { |listing| ids.fetch(listing.fetch("id")) },
        next_cursor: result.value[:next_cursor], retrieved_at: now)
      page_result(page)
    end

    def page_result(page, errors: [])
      by_id = JobBoardListing.where(id: page.listing_ids).index_by(&:id)
      success(listings: page.listing_ids.filter_map { |id| by_id[id] }, next_cursor: page.next_cursor,
        retrieved_at: page.retrieved_at, stale: errors.any?, errors: errors)
    end
  end
end
