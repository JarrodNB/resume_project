# Imports an operator-verified provider receipt without rerunning a model or guessing a bill.
# Dry-run is the default. Applying retains the old receipt and changes totals exactly once,
# under the same owner/task lock order as live result delivery. Never exposed through GraphQL.
module AiUsage
  class ReconcileReceiptService < ApplicationService
    TOKEN_FIELDS = %w[input_tokens cached_input_tokens cache_write_tokens output_tokens audio_milliseconds characters cost_microdollars].freeze
    TEXT_FIELDS = %w[model provider stage provider_response_id].freeze

    def initialize(user:, record_type:, attempt_id:, receipt_reference:, usage:, apply: false)
      @user, @record_type, @attempt_id = user, record_type, attempt_id
      @reference, @usage, @apply = receipt_reference, usage, apply
    end

    def call
      return failure("Invalid verified receipt") unless valid_receipt?

      @user.with_lock do
        if @record_type == "embedding"
          request = @user.ai_embedding_requests.lock.find(@attempt_id)
          reconcile(request, previous_usage: [ { "input_tokens" => request.input_tokens, "cost_microdollars" => request.cost_microdollars } ]) do
            request.update!(cost_microdollars: total(@usage, "cost_microdollars"),
              input_tokens: @usage.first["input_tokens"] || request.input_tokens, incomplete: false, finalized: true)
          end
        else
          report = AiUsageAttempt.joins(:ai_task).where(ai_tasks: { user_id: @user.id }).find_by!(attempt_id: @attempt_id)
          task = @user.ai_tasks.find(report.ai_task_id)
          task.with_lock do
            report.reload.lock!
            reconcile(report, previous_usage: AiUsage::AttemptEntries.as_hashes(report)) do
              change = AiUsage::AttemptEntries.replace(report, @usage)
              task.update!(AiTasks::RecordAttemptUsageService::COLUMNS.index_with { |column| task.public_send(column) + change[column] })
              report.update!(incomplete: false, finalized: true)
              reconcile_verification_reservation
            end
          end
        end
      end
    rescue ActiveRecord::RecordNotFound
      failure("Accounting request not found for this user")
    rescue ActiveRecord::RecordNotUnique
      failure("Receipt reference is already in use")
    end

    private

    def reconcile(record, previous_usage:)
      existing = AiUsageReconciliation.find_by(record_type: @record_type, attempt_id: @attempt_id)
      if existing
        return existing.receipt_reference == @reference && existing.usage == @usage ? success(false) : failure("Receipt conflicts with prior reconciliation")
      end
      return failure("Receipt reference is already in use") if AiUsageReconciliation.exists?(receipt_reference: @reference)

      change = { previous_cost_microdollars: total(previous_usage, "cost_microdollars"),
        cost_microdollars: total(@usage, "cost_microdollars"), was_incomplete: record.incomplete? }
      if @apply
        AiUsageReconciliation.create!(record_type: @record_type, attempt_id: @attempt_id,
          receipt_reference: @reference, previous_usage: previous_usage, usage: @usage)
        yield
      end
      success(change)
    end

    # Keep the retained paid-verification ledger consistent with resolved spoken receipts.
    def reconcile_verification_reservation
      return unless InterviewVerificationReservation.exists?(observation_id: @attempt_id)

      Interviews::VerificationBudget.reconcile_verified(observation_id: @attempt_id,
        cost: total(@usage, "cost_microdollars"))
    end

    def total(entries, column)
      entries.sum { |entry| entry.fetch(column, 0).to_i }
    end

    def valid_receipt?
      %w[task embedding].include?(@record_type) && @reference.is_a?(String) && @reference.present? && @reference.size <= 512 &&
        @usage.is_a?(Array) && @usage.size.between?(1, 100) && (@record_type != "embedding" || @usage.size == 1) &&
        @usage.all? do |entry|
          entry.is_a?(Hash) && entry.key?("cost_microdollars") && (entry.keys - TOKEN_FIELDS - TEXT_FIELDS).empty? &&
            entry.all? do |key, value|
              TOKEN_FIELDS.include?(key) ? value.is_a?(Integer) && value.between?(0, 1_000_000_000_000) : value.is_a?(String) && value.size <= 256
            end
        end
    end
  end
end
