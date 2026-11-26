# The small list of questions the shared operation lifecycle asks each feature.
#
# `AiExecutions::OperationLifecycle` owns leases, fencing, deadlines, retry budgets and
# recovery for any claimed operation. Chat and interviews differ in a few places (what
# the owner lock covers, when a receipt counts as finished, which failure codes are
# final), so each subclass answers those questions here and nothing else.
module AiExecutions
  class OperationPolicy
    attr_reader :operation

    def initialize(operation)
      @operation = operation
    end

    # "chat" or "interviews": the name used by the dispatch, nudge and recovery jobs.
    def feature = raise(NotImplementedError)

    # The owning record (conversation or interview session) that is locked first.
    def owner = raise(NotImplementedError)

    # Lock any extra rows the feature needs after the owner row. Lock order stays:
    # user, owner, feature rows, operation, task.
    def lock_owner_records(_owner); end

    def failure_codes = raise(NotImplementedError)

    # Failure codes that retrying cannot fix, so they are never retried automatically.
    def non_retryable_codes = raise(NotImplementedError)

    # Extra owner checks that must hold for a lease to count as current.
    def claim_allowed? = raise(NotImplementedError)

    # True when the operation state means the work already finished (for the renew receipt).
    def finished_state? = raise(NotImplementedError)

    # Extra conditions before a matching finished receipt may be returned on renew.
    def receipt_allowed?(attempt_id:, checkpoint:) = true

    # Checkpoint names a heartbeat may report. Nil means the feature has no checkpoints.
    def checkpoints = nil

    # Failure code stored when a claim finds a running attempt whose lease has ended.
    def stale_claim_code = "lease_expired"

    # Kept per feature because callers can read these messages from the internal API.
    def invalid_failure_message = raise(NotImplementedError)

    # Reply for a failure report that arrives after the work was already settled (nil: no such case).
    def settled_failure_report = nil

    def failure_report = { status: operation.status }

    # Expire the operation if its owner or media has run out. Returns true when it did.
    def expire_if_due? = false

    # Feature side effects after a failure was recorded (publish an update, expire media).
    def after_failure(_code, retryable:, automatic:); end
  end
end
