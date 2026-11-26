# Description: Limits how many calls to the shared Job Board provider one account can cause per hour,
# so a single account can't use up the provider's monthly quota or tie up server connections.
# Searches count only when the provider is really called (a cached page costs nothing); location
# lookups are never cached, so each one counts. The counters live in Rails.cache (shared by all
# processes) in one-hour windows. If the cache can't count, the call is allowed rather than blocking
# everyone. Limits are real configuration: JOB_BOARD_SEARCHES_PER_HOUR and JOB_BOARD_LOCATION_LOOKUPS_PER_HOUR.
# Index:
#   - allow?: counts one call for the account and says whether it is within the limit
#   - provider_for: wraps a search provider so each real call is counted and can be refused
module JobBoard
  class ProviderCallLimit
    LIMITS = {
      search: Integer(ENV.fetch("JOB_BOARD_SEARCHES_PER_HOUR", "60")),
      locations: Integer(ENV.fetch("JOB_BOARD_LOCATION_LOOKUPS_PER_HOUR", "120"))
    }.freeze
    MESSAGE = "You're searching very quickly. Please wait a few minutes and try again.".freeze

    # @param kind [Symbol] :search or :locations
    # @return [Boolean] false when this call is over the account's hourly limit
    def self.allow?(user:, kind:)
      window = Time.now.utc.strftime("%Y%m%d%H")
      count = Rails.cache.increment("job_board/provider_calls/#{kind}/#{user.id}/#{window}", 1, expires_in: 2.hours)
      count.nil? || count <= LIMITS.fetch(kind)
    end

    # A callable with the same shape as the search provider. Over the limit it returns a failed
    # result without calling the provider, which SearchCatalogueService treats like any provider failure
    # (a stale cached page is still shown).
    def self.provider_for(user:, provider: JobBoard::SearchCleanJobDataService)
      lambda do |**arguments|
        next ServiceResult.new(success: false, value: nil, errors: [ MESSAGE ]) unless allow?(user: user, kind: :search)

        provider.call(**arguments)
      end
    end
  end
end
