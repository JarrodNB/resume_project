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
      return false unless exact_keys?(@result, %w[confirmed_revision listings]) && @result["confirmed_revision"] == @task.input["confirmed_revision"]
      actual, expected = @result["listings"], @task.input["listings"]
      return false unless actual.is_a?(Array) && actual.size == expected.size
      actual.zip(expected).all? do |item, source|
        exact_keys?(item, %w[id source_digest criteria]) && item["id"] == source["id"] && item["source_digest"] == source["source_digest"] &&
          valid_criteria?(item["criteria"], source)
      end
    end

    def valid_criteria?(actual, source)
      expected = @task.input["criteria"]
      return false unless actual.is_a?(Array) && actual.size == expected.size
      actual.zip(expected).all? do |decision, criterion|
        next false unless exact_keys?(decision, %w[id status reason support contradiction]) && decision["id"] == criterion["id"] &&
          valid_evidence?(decision["support"], source) && valid_evidence?(decision["contradiction"], source)
        support, conflict = decision.values_at("support", "contradiction")
        status, reason = if support && conflict
          ["unknown", "contradictory_evidence"]
        elsif support
          ["matching", "supported"]
        elsif conflict
          ["conflicting", "contradicted"]
        else
          ["unknown", source["truncated"] ? "incomplete_source" : "not_stated"]
        end
        decision["status"] == status && decision["reason"] == reason
      end
    end

    def valid_evidence?(evidence, source)
      return true if evidence.nil?
      return false unless exact_keys?(evidence, %w[passage_id text])
      source["passages"].any? { |p| p["id"] == evidence["passage_id"] && p["text"] == evidence["text"] }
    end

    def exact_keys?(value, keys)
      value.is_a?(Hash) && value.keys.sort == keys.sort
    end
  end
end
