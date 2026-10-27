# Snapshot shared listings for one user's optional ranking task. Only catalogue text is
# queued; browser input supplies IDs and a search phrase, never arbitrary job descriptions.
module JobBoard
  class StartRerankingService < ApplicationService
    MAX_LISTINGS = 100
    MAX_INPUT_BYTES = 200_000
    TEXT_BUDGET_BYTES = 140_000
    MAX_LISTING_TEXT_BYTES = 6_000
    UUID = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

    # @param listing_ids [Array<String>] one to 100 distinct shared catalogue UUIDs
    # @param keyword [String] the submitted search phrase used for keyword relevance
    # @return [ServiceResult] the user's queued task, or safe validation/allowance errors
    def initialize(user:, listing_ids:, keyword:)
      @user, @listing_ids, @keyword = user, listing_ids, keyword
    end

    def call
      snapshot = build_snapshot
      return snapshot unless snapshot.success?
      @input = snapshot.value
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "rerank_job_listings",
        input: @input, resolve_existing: method(:resolve_existing), prepare_task: method(:prepare_task))
    end

    private

    def build_snapshot
      return failure([ "Enter a search phrase of 1 to 200 characters." ]) unless @keyword.is_a?(String) &&
        @keyword.valid_encoding? && @keyword.strip.present? && @keyword.length <= 200 && !@keyword.match?(/[[:cntrl:]]/)
      return failure([ "Select between 1 and 100 distinct listings to rerank." ]) unless @listing_ids.is_a?(Array) &&
        @listing_ids.size.between?(1, MAX_LISTINGS) && @listing_ids.all? { |id| id.is_a?(String) && id.match?(UUID) }
      ids = @listing_ids.map(&:downcase)
      return failure([ "Select between 1 and 100 distinct listings to rerank." ]) unless ids.uniq.size == ids.size
      by_id = JobBoardListing.where(id: ids).index_by(&:id)
      return failure([ "Some search listings are no longer available. Search again." ]) unless by_id.size == ids.size
      byte_budget = [ TEXT_BUDGET_BYTES / ids.size, MAX_LISTING_TEXT_BYTES ].min
      listings = ids.map do |id|
        payload = by_id.fetch(id).payload
        title = payload["title"].is_a?(String) ? payload["title"] : ""
        description = ListingDescription.new(payload["description"].to_s).text
        { "id" => id, "text" => "Job: #{title}\nDescription:\n#{description}".truncate_bytes(byte_budget, omission: "") }
      end
      input = { "keyword" => @keyword.strip, "listings" => listings }
      return failure([ "These search listings are too large to rerank. Narrow your search and try again." ]) if JSON.generate(input).bytesize > MAX_INPUT_BYTES
      success(input)
    end

    def prepare_task(task)
      available = @user.library_embeddings.where(model: CareerLibraryEmbeddings::MODEL,
        source_type: LibraryEmbedding::SOURCE_TYPES).where.not(embedding: nil).exists?
      return failure([ "Add career library entries and wait for their search index before reranking." ]) unless available
      success(task)
    end

    def resolve_existing
      task = @user.ai_tasks.where(task_type: "rerank_job_listings", status: "queued", input: @input,
        created_at: AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago..).order(created_at: :desc).first
      success(task) if task
    end
  end
end
