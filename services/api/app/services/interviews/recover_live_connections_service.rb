# Ends live interview rooms whose agent went quiet, so they never stay open forever. The live
# agent sends a heartbeat about every 30 seconds while it runs, even while the candidate is
# away, so a connected room with no heartbeat for 150 seconds lost its agent (for example the
# process crashed): it ends as `disconnected`. A joined room the agent never claimed within the
# join token's 10 minutes ends as `failed`. Both go through Interviews::FinishLiveService, so the
# interview is completed with at least one saved answer and abandoned otherwise. No final
# heartbeat is named, so the provider bill stays unknown rather than looking complete.
#
# Safe to run twice and to race a late agent call: the finish re-checks under row locks that the
# connection is still open and still quiet (a heartbeat or claim that got in first wins), and a
# finished connection is skipped. Works in bounded batches, oldest first.
module Interviews
  class RecoverLiveConnectionsService < ApplicationService
    HEARTBEAT_TIMEOUT = 150.seconds
    CLAIM_TIMEOUT = JoinLiveService::TOKEN_TTL

    def initialize(limit: 50)
      @limit = limit
    end

    # @return [ServiceResult<Integer>] how many connections were ended
    def call
      now = Time.current
      quiet = InterviewLiveConnection.open.where(
        "(status = 'connected' AND COALESCE(last_heartbeat_at, connected_at, created_at) <= :quiet) OR " \
        "(status = 'authorized' AND created_at <= :unclaimed)", quiet: now - HEARTBEAT_TIMEOUT, unclaimed: now - CLAIM_TIMEOUT)
      ended = quiet.order(:created_at, :id).limit(@limit).to_a.count do |connection|
        claimed = connection.status == "connected"
        FinishLiveService.call(connection: connection, reason: claimed ? "disconnected" : "failed",
          stale_before: now - (claimed ? HEARTBEAT_TIMEOUT : CLAIM_TIMEOUT)).success?
      end
      success(ended)
    end
  end
end
