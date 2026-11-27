# Keeps one live connection's provider bill in the shared AI usage ledger.
#
# When the agent claims a connection it gets one `interview_live_conversation` AI task (sharing
# the interview's hourly admission, like other interview child tasks), one provider observation
# with its conservative verification reservation, and an unfinished usage report for that
# observation. Each heartbeat adds its usage deltas to the report's running totals, one entry per
# model (the realtime model and its input transcription), so daily spend sees live costs while the
# interview runs. The hidden daily spend cap never stops a running live session; the live
# allowance is its limit. Finishing closes the report: known only when the agent's final heartbeat
# was the last one applied and every entry has a price; otherwise it stays unknown on the ledger.
# Callers hold the user, interview and connection locks.
module Interviews
  module LiveConversationBill
    STAGE = "live_conversation".freeze
    PROVIDER = "openai".freeze
    REALTIME_MODEL = "gpt-realtime-2.1-mini".freeze
    TRANSCRIPTION_MODEL = TranscriptionCaptureService::MODEL
    MODELS = [ REALTIME_MODEL, TRANSCRIPTION_MODEL ].freeze
    COUNTS = %w[input_tokens cached_input_tokens output_tokens audio_milliseconds cost_microdollars].freeze
    MAX_COUNT = 1_000_000_000

    # Opens the bill once per connection; a repeat claim keeps the first one.
    # @return [Boolean] false only when the live model has no registered reservation
    def self.open(connection, interview)
      return true if connection.ai_task

      observation_id = SecureRandom.uuid
      return false unless VerificationBudget.reserve(observation_id: observation_id, stage: STAGE, provider: PROVIDER, model: REALTIME_MODEL)

      task = interview.user.ai_tasks.create!(counts_toward_trial_budget: AiUsage::SiteDailySpend.counts_user?(interview.user),
        task_type: "interview_live_conversation", subject: interview, hourly_admission_task: interview.operations.preparation.first&.ai_task,
        input: { live_connection_id: connection.id })
      AiTasks::RecordAttemptUsageService.call(ai_task: task, message: { "attempt_id" => observation_id, "attempt_finished" => false })
      connection.update!(ai_task: task, observation_id: observation_id)
      true
    end

    # True when `usage` is a list of at most one delta per known model with bounded counts only.
    def self.valid_usage?(usage)
      usage.is_a?(Array) && usage.length <= MODELS.length && usage.all? do |entry|
        entry.is_a?(Hash) && MODELS.include?(entry["model"]) && (entry.keys - [ "model", *COUNTS ]).empty? &&
          entry.except("model").values.all? { |value| value.is_a?(Integer) && value.between?(0, MAX_COUNT) }
      end && usage.map { |entry| entry["model"] }.uniq.length == usage.length
    end

    # Adds one heartbeat's deltas to the running totals. A delta without a price leaves that
    # model's cost unknown for the rest of the connection.
    def self.add(connection, usage)
      return if usage.empty?

      task = connection.ai_task.lock!
      report = task.ai_usage_attempts.find_by!(attempt_id: connection.observation_id)
      totals = AiUsage::AttemptEntries.as_hashes(report).index_by { |entry| entry["model"] }
      usage.each do |delta|
        previous = totals[delta["model"]]
        priced = delta.key?("cost_microdollars") && (previous.nil? || previous.key?("cost_microdollars"))
        entry = { "stage" => STAGE, "provider" => PROVIDER, "model" => delta["model"] }
        (COUNTS - [ "cost_microdollars" ]).each do |count|
          entry[count] = previous.to_h[count].to_i + delta[count].to_i if delta.key?(count) || previous&.key?(count)
        end
        entry["cost_microdollars"] = previous.to_h["cost_microdollars"].to_i + delta["cost_microdollars"] if priced
        totals[delta["model"]] = entry
      end
      AiUsage::AttemptEntries.replace(report, totals.values, ai_task: task)
    end

    # Closes the bill and its task. `known` says the agent reported all usage.
    def self.close(connection, known:)
      return unless connection.ai_task

      task = connection.ai_task.lock!
      report = task.ai_usage_attempts.find_by!(attempt_id: connection.observation_id)
      entries = AiUsage::AttemptEntries.as_hashes(report)
      known &&= entries.all? { |entry| entry.key?("cost_microdollars") }
      report.update!(finalized: true, incomplete: !known)
      VerificationBudget.reconcile(observation_id: connection.observation_id, cost: entries.sum { |entry| entry["cost_microdollars"] }) if known
      AiTasks::UpdateTaskService.call(task: task, attributes: { status: "completed", completed_at: Time.current }) unless task.finished?
    end
  end
end
