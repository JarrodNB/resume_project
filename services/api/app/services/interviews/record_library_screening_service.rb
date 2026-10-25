# Remembers successful screening of exact frozen sources before dependent model work.
# Only a current execution may report source indices. Live fields earn approval only
# when their owned, locked value still equals the screened snapshot; replay is harmless.
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

        @indices.uniq.each do |index|
          source = sources[index]
          source["screened"] = true
          record = FrozenLibraryScreening.owned_record(interview.user, source)
          next unless record

          record.with_lock do
            next unless record[source["field"]] == source["text"]
            fields = record.screened_fields | [ source["field"] ]
            record.update!(screened_fields: fields) if fields != record.screened_fields
          end
        end
        interview.update!(frozen_context: context) if context != interview.frozen_context
        receipt = { screened_source_indices: sources.each_index.select { |index| sources[index]["screened"] == true } }
        receipt[:screened_career_focus_sha256] = @focus_digest unless @focus_digest.nil?
        success(receipt)
      end
    end
  end
end
