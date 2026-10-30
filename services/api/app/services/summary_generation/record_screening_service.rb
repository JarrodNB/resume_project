# Saves the screening receipts a summary-generation task sends back, but only for career
# facts that task actually froze. A receipt field counts only when its record type, id and
# field name appear in the task's snapshot sources and its fingerprint matches the frozen
# text. The shared recorder then also requires the live value to match under a row lock,
# so a fact edited after queueing is never approved. Resume-section copies have no record
# id in the snapshot and can never be approved here.
module SummaryGeneration
  class RecordScreeningService < ApplicationService
    # @param ai_task [AiTask] a generate_summary task with its frozen input
    # @param receipts [Array<Hash>] career-library `record_screening` receipts from the worker
    def initialize(ai_task:, receipts:)
      @ai_task, @receipts = ai_task, receipts
    end

    # @return [ServiceResult] always succeeds; receipts that fail a rule are skipped.
    def call
      frozen = frozen_values
      reports = Array(@receipts).filter_map do |receipt|
        next unless receipt.is_a?(Hash) && receipt["fingerprints"].is_a?(Hash)

        fingerprints = receipt["fingerprints"].select do |field, fingerprint|
          value = frozen[[ receipt["record_type"], receipt["record_id"], field ]]
          value && fingerprint == Screening::RecordApprovalsService.field_fingerprint(value)
        end
        receipt.slice("record_type", "record_id").merge("fingerprints" => fingerprints) if fingerprints.any?
      end
      Screening::RecordApprovalsService.call(user: @ai_task.user, reports: reports)
    end

    private

    # [record_type, record_id, field] => frozen text, for library sources only.
    def frozen_values
      sources = @ai_task.input.is_a?(Hash) ? @ai_task.input["sources"] : nil
      Array(sources).each_with_object({}) do |source, values|
        next unless source.is_a?(Hash) && Screening::RecordApprovalsService::LIBRARY_TYPES.include?(source["record_type"]) &&
          source["record_id"].is_a?(String) && source["field"].is_a?(String) && source["text"].is_a?(String)

        values[[ source["record_type"], source["record_id"], source["field"] ]] = source["text"]
      end
    end
  end
end
