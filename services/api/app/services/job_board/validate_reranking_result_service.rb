# Accept only an exact reordering of the task's selected listing IDs. A worker cannot
# add another listing, drop a candidate, or overwrite an already finished outcome.
module JobBoard
  class ValidateRerankingResultService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      expected = @task.input["listing_ids"] || @task.input["listings"]
      expected = expected.map { |entry| entry.is_a?(Hash) ? entry["id"] : entry } if expected.is_a?(Array)
      actual = @result["ranked_listing_ids"] if @result.is_a?(Hash)
      valid = @result.is_a?(Hash) && @result.keys == [ "ranked_listing_ids" ] &&
        expected.is_a?(Array) && expected.size.between?(1, StartRerankingService::MAX_LISTINGS) &&
        expected.all? { |id| id.is_a?(String) } && expected.uniq.size == expected.size &&
        actual.is_a?(Array) && actual.all? { |id| id.is_a?(String) } && actual.sort == expected.sort
      valid ? success(@result) : failure([ "The reranking result did not match these search listings. Please try again." ])
    end
  end
end
