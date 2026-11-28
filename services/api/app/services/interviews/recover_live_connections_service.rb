# Ends live interview rooms whose agent went quiet, so they never stay open forever. The live
# agent sends a heartbeat about every 30 seconds while it runs, even while the candidate is
# away, so a connected room with no heartbeat for 150 seconds lost its agent (for example the
# process crashed): it ends as `disconnected`. A joined room the agent never claimed within the
# latest join token's 10 minutes ends as `failed` (a rejoin signs a fresh token, so the wait starts
# again at `authorized_at`). Both go through Interviews::FinishLiveService, so the
# interview is completed with at least one saved answer and abandoned otherwise. No final
# heartbeat is named, so the provider bill stays unknown rather than looking complete.
# A connected room still open 5 minutes past its 45-minute wall-clock cap
# (LiveAllowance::CONNECTION_WALL_CLOCK) ends as `time_limit` even while it heartbeats: its agent
# ignored the heartbeat's wrap-up.
#
# Safe to run twice and to race a late agent call: the finish re-checks under row locks that the
# connection is still open and still quiet (a heartbeat or claim that got in first wins), and a
# finished connection is skipped. Works in bounded batches, oldest first. A finish that raises is
# logged and reported, and the rest of the batch still runs; that connection is tried again next run.
module Interviews
  class RecoverLiveConnectionsService < ApplicationService
    HEARTBEAT_TIMEOUT = 150.seconds
    CLAIM_TIMEOUT = JoinLiveService::TOKEN_TTL
    WALL_CLOCK_MARGIN = 5.minutes

    def initialize(limit: 50)
      @limit = limit
    end

    # @return [ServiceResult<Integer>] how many connections were ended
    def call
      now = Time.current
      quiet = InterviewLiveConnection.open.where(
        "(status = 'connected' AND COALESCE(last_heartbeat_at, connected_at, created_at) <= :quiet) OR " \
        "(status = 'authorized' AND COALESCE(authorized_at, created_at) <= :unclaimed)", quiet: now - HEARTBEAT_TIMEOUT, unclaimed: now - CLAIM_TIMEOUT)
      ended = quiet.order(:created_at, :id).limit(@limit).to_a.count do |connection|
        claimed = connection.status == "connected"
        finish(connection, reason: claimed ? "disconnected" : "failed", stale_before: now - (claimed ? HEARTBEAT_TIMEOUT : CLAIM_TIMEOUT))
      end
      success(ended + end_over_wall_clock(now))
    end

    private

    # One connection whose finish raises must not stop the rest: it is reported and tried again next run.
    def finish(connection, **options)
      FinishLiveService.call(connection: connection, **options).success?
    rescue StandardError => error
      Rails.logger.error("Live connection recovery failed for #{connection.id}: #{error.class.name}")
      Rails.error.report(error, handled: true, context: { live_connection_id: connection.id })
      false
    end

    # Connections whose agent kept talking past the wall-clock cap and its margin.
    def end_over_wall_clock(now)
      over = InterviewLiveConnection.open.where(status: "connected")
        .where(connected_at: ..(now - LiveAllowance::CONNECTION_WALL_CLOCK - WALL_CLOCK_MARGIN))
      over.order(:connected_at, :id).limit(@limit).to_a.count do |connection|
        finish(connection, reason: "time_limit")
      end
    end
  end
end
