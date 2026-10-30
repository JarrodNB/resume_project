# Remembers successful screening of exact frozen career and job sources before model work.
# Only a current execution may report source indices. Live fields earn approval through the
# shared recorder: the owned, locked value must match the screened frozen value's fingerprint,
# and jobs must be this interview's own saved job. Replay is harmless.
# Lock order: the interview operation lock (user row first) is taken before any record row.
# Record rows then follow the shared recorder's order (job before library types, ids sorted
# within a type), not source-index order. That is safe because every path that locks several
# screened records, here and in AI-result application, takes the user lock first.
# Preparation may also remember an exact frozen career-focus check, never a session-wide pass.
require "digest"
require "json"
module Interviews
  class RecordLibraryScreeningService < ApplicationService
    include ExecutionPolicy

    def initialize(operation:, attempt_id:, claim_generation:, source_indices:, career_focus_sha256: nil)
      @operation, @attempt_id, @generation = operation, attempt_id, claim_generation
      @indices, @focus_digest = source_indices, career_focus_sha256
    end

    # @return [ServiceResult<Hash>] all approved indices in this frozen snapshot
    def call
      return failure("Invalid source indices") unless @indices.is_a?(Array) && @indices.all? { |index| index.is_a?(Integer) && index >= 0 }

      with_operation_lock do |interview|
        next failure("Claim is stale or expired") unless current_claim?
        eligible = (@operation.preparation? && interview.preparing?) ||
          (@operation.turn? && interview.active? && @operation.expected_revision == interview.revision &&
            @operation.question.position == interview.current_question_position)
        next failure("Operation cannot approve library sources") unless eligible
        context = interview.frozen_context.deep_dup
        sources = context["sources"]
        next failure("Invalid source indices") unless sources.is_a?(Array) && @indices.all? { |index| index < sources.length && FrozenLibraryScreening.valid_source?(sources[index]) }

        unless @focus_digest.nil?
          focus = context["career_focus"]
          # Admission and Python preserve nonempty Unicode whitespace strings exactly.
          valid_focus = @operation.preparation? && interview.preparing? && focus.is_a?(String) && !focus.empty? &&
            @focus_digest.is_a?(String) && @focus_digest.match?(/\A[0-9a-f]{64}\z/) &&
            @focus_digest == Digest::SHA256.hexdigest(JSON.generate(focus))
          next failure("Invalid career focus check") unless valid_focus
          context["screened_career_focus_sha256"] = @focus_digest
        end

        receipts = @indices.uniq.map do |index|
          sources[index]["screened"] = true
          FrozenLibraryScreening.approval_receipt(sources[index])
        end
        Screening::RecordApprovalsService.record_interview_sources(interview: interview, reports: receipts)
        interview.update!(frozen_context: context) if context != interview.frozen_context
        receipt = { screened_source_indices: sources.each_index.select { |index| sources[index]["screened"] == true } }
        receipt[:screened_career_focus_sha256] = @focus_digest unless @focus_digest.nil?
        success(receipt)
      end
    end
  end
end
