# Persists summary screening only for the referenced owned field and exact hash.
# The shared recorder locks and checks the live value before approving it.
module SummaryGeneration
  class RecordScreeningService < ApplicationService
    # @param ai_task [AiTask] a generate_summary task with source references
    # @param receipts [Array<Hash>] career-library `record_screening` receipts from the worker
    def initialize(ai_task:, receipts:)
      @ai_task, @receipts = ai_task, receipts
    end

    # @return [ServiceResult] always succeeds; receipts that fail a rule are skipped.
    def call
      expected = expected_fingerprints
      reports = Array(@receipts).filter_map do |receipt|
        next unless receipt.is_a?(Hash) && receipt["fingerprints"].is_a?(Hash)

        fingerprints = receipt["fingerprints"].select do |field, fingerprint|
          value = expected[[ receipt["record_type"], receipt["record_id"], field ]]
          value && fingerprint == value
        end
        receipt.slice("record_type", "record_id").merge("fingerprints" => fingerprints) if fingerprints.any?
      end
      Screening::RecordApprovalsService.call(user: @ai_task.user, reports: reports)
    end

    private

    # [record_type, record_id, field] => expected field fingerprint, for library sources only.
    def expected_fingerprints
      return {} unless @ai_task.input["command_version"] == 1 && @ai_task.input["target_kind"] == "profile"
      sources = @ai_task.input.is_a?(Hash) ? @ai_task.input["source_references"] : nil
      Array(sources).each_with_object({}) do |source, values|
        next unless source.is_a?(Hash) && source["label"].is_a?(String) && source["record_id"].is_a?(String) && source["fingerprint"].is_a?(String)

        record_type, field = SourceReferences.record_identity(source["label"])
        next unless Screening::RecordApprovalsService::LIBRARY_TYPES.include?(record_type)

        values[[ record_type, source["record_id"], field ]] = source["fingerprint"]
      end
    end
  end
end
