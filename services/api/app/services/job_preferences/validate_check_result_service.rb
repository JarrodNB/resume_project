# Accept complete, finite preference probabilities for the exact confirmed sources.
# Called inside the shared owner/task transaction; duplicate and late usage retain shared policy.
module JobPreferences
  class ValidateCheckResultService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      return failure([ "Preferences or listing content changed. Refresh and check again." ]) unless current?
      valid_result? ? success(@result) : failure([ "The preference check returned invalid probabilities. Please try again." ])
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
        exact_keys?(item, %w[id source_digest truncated criteria]) && item["id"] == source["id"] &&
          item["source_digest"] == source["source_digest"] && item["truncated"] == source["truncated"] &&
          valid_criteria?(item["criteria"])
      end
    rescue JSON::GeneratorError
      false
    end

    def valid_criteria?(actual)
      expected = @task.input["criteria"]
      return false unless actual.is_a?(Array) && actual.size == expected.size
      actual.zip(expected).all? do |decision, criterion|
        next false unless exact_keys?(decision, %w[id probability]) && decision["id"] == criterion["id"]
        probability = decision["probability"]
        probability.is_a?(Numeric) && probability.finite? && probability.between?(0, 1)
      end
    end

    def exact_keys?(value, keys)
      value.is_a?(Hash) && value.keys.sort == keys.sort
    end
  end
end
