# Accept only complete criterion decisions backed by exact frozen passages for current sources.
# Called inside the shared owner/task transaction; duplicate and late usage retain shared policy.
module JobPreferences
  class ValidateCheckResultService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      return failure([ "Preferences or listing content changed. Refresh and check again." ]) unless current?
      valid_result? ? success(@result) : failure([ "The preference check returned invalid evidence. Please try again." ])
    end

    private

    def current?
      profile = @task.user.reload.job_preference_profile
      return false unless profile && profile.id == @task.input["profile_id"] &&
        profile.confirmed_revision == @task.input["confirmed_revision"] &&
        profile.confirmed_criteria == @task.input["criteria"].map { |c| c.slice("id", "text", "priority") }
      @task.input["listings"].all? do |item|
        listing = JobBoardListing.find_by(id: item["id"])
        listing && JobBoard::PreferenceListingSnapshot.new(listing).digest == item["source_digest"]
      end
    end

    def valid_result?
      return false if JSON.generate(@result).bytesize > StartCheckService::MAX_RESULT_BYTES
      return false unless exact_keys?(@result, %w[confirmed_revision listings]) && @result["confirmed_revision"] == @task.input["confirmed_revision"]
      actual, expected = @result["listings"], @task.input["listings"]
      return false unless actual.is_a?(Array) && actual.size == expected.size
      actual.zip(expected).all? do |item, source|
        exact_keys?(item, %w[id source_digest truncated criteria evidence_passages]) && valid_passages?(item, source) && item["id"] == source["id"] && item["source_digest"] == source["source_digest"] && item["truncated"] == source["truncated"] &&
          valid_criteria?(item["criteria"], source)
      end
    end

    def valid_passages?(item, source)
      passages = item["evidence_passages"]
      return false unless passages.is_a?(Array) && passages.size <= source["passages"].size
      return false unless passages.all? { |p| exact_keys?(p, %w[passage_id text]) && source["passages"].any? { |s| s["id"] == p["passage_id"] && s["text"] == p["text"] } }
      return false unless passages.pluck("passage_id").uniq.size == passages.size
      referenced = item["criteria"].is_a?(Array) && item["criteria"].flat_map { |c| c.is_a?(Hash) ? [ c["support"], c["contradiction"] ] : [] }.compact
      referenced.is_a?(Array) && referenced.all? { |r| r.is_a?(Hash) && passages.any? { |p| p["passage_id"] == r["passage_id"] } }
    end

    def valid_criteria?(actual, source)
      expected = @task.input["criteria"]
      return false unless actual.is_a?(Array) && actual.size == expected.size
      actual.zip(expected).all? do |decision, criterion|
        next false unless exact_keys?(decision, %w[id status reason support contradiction]) && decision["id"] == criterion["id"] &&
          valid_evidence?(decision["support"], source) && valid_evidence?(decision["contradiction"], source)
        support, conflict = decision.values_at("support", "contradiction")
        status, reason = if support && conflict
          [ "unknown", "contradictory_evidence" ]
        elsif support
          [ "matching", "supported" ]
        elsif conflict
          [ "conflicting", "contradicted" ]
        else
          [ "unknown", source["truncated"] ? "incomplete_source" : "not_stated" ]
        end
        decision["status"] == status && decision["reason"] == reason
      end
    end

    def valid_evidence?(evidence, source)
      return true if evidence.nil?
      return false unless exact_keys?(evidence, %w[passage_id])
      source["passages"].any? { |p| p["id"] == evidence["passage_id"] }
    end

    def exact_keys?(value, keys)
      value.is_a?(Hash) && value.keys.sort == keys.sort
    end
  end
end
