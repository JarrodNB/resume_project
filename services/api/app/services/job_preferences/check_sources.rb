# Compare a saved preference command with current owned criteria and listing excerpts.
# Retained legacy copies are comparison fences only; they never replace current records.
module JobPreferences
  module CheckSources
    module_function

    def criterion_matches?(reference, current)
      return false unless reference.is_a?(Hash) && current && reference["id"] == current["id"] && reference["priority"] == current["priority"]
      fingerprint = reference["text_sha256"] || Screening::RecordApprovalsService.field_fingerprint(reference["text"])
      fingerprint == Screening::RecordApprovalsService.field_fingerprint(current["text"])
    end

    def listing_matches?(reference, current)
      return false unless reference.is_a?(Hash) && reference["id"] == current["id"] &&
        reference["source_digest"] == current["source_digest"] && reference["truncated"] == current["truncated"]
      fingerprint = reference["passages_sha256"]
      fingerprint ||= Screening::RecordApprovalsService.field_fingerprint(reference["passages"].map { |p| p["text"] }) if reference["passages"].is_a?(Array)
      fingerprint == Screening::RecordApprovalsService.field_fingerprint(current["passages"].pluck("text"))
    end

    def listing_source(listing, count)
      budget = [ StartCheckService::TEXT_BUDGET_BYTES / count, JobBoard::PreferenceListingSources::MAX_TEXT_BYTES ].min
      JobBoard::PreferenceListingSources.new(listing).projection(max_text_bytes: budget)
    end
  end
end
