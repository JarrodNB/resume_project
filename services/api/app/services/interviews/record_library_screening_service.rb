# Remembers successful screening of exact frozen sources before dependent model work.
# Only a current execution may report source indices. Live fields earn approval only
# when their owned, locked value still equals the screened snapshot; replay is harmless.
module Interviews
  class RecordLibraryScreeningService < ApplicationService
    include ExecutionPolicy

    def initialize(operation:, attempt_id:, claim_generation:, source_indices:)
      @operation, @attempt_id, @generation = operation, attempt_id, claim_generation
      @indices = source_indices
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
        success({ screened_source_indices: sources.each_index.select { |index| sources[index]["screened"] == true } })
      end
    end
  end
end
