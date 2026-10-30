# Queue catalogue identities for optional ranking. Python reads current public listing
# text itself; the durable command stores only the selection and search phrase.
module JobBoard
  class StartRerankingService < ApplicationService
    MAX_LISTINGS = 100
    UUID = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

    # @param listing_ids [Array<String>] one to 100 distinct shared catalogue UUIDs
    # @param keyword [String] the submitted search phrase used for keyword relevance
    # @return [ServiceResult] the user's queued task, or safe validation/allowance errors
    def initialize(user:, listing_ids:, keyword:)
      @user, @listing_ids, @keyword = user, listing_ids, keyword
    end

    def call
      command = build_command
      return command unless command.success?
      @input = command.value
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "rerank_job_listings",
        input: @input, resolve_existing: method(:resolve_existing), prepare_task: method(:prepare_task))
    end

    private

    def build_command
      return failure([ "Enter a search phrase of 1 to 200 characters." ]) unless @keyword.is_a?(String) &&
        @keyword.valid_encoding? && @keyword.strip.present? && @keyword.length <= 200 && !@keyword.match?(/[[:cntrl:]]/)
      return failure([ "Select between 1 and 100 distinct listings to rerank." ]) unless @listing_ids.is_a?(Array) &&
        @listing_ids.size.between?(1, MAX_LISTINGS) && @listing_ids.all? { |id| id.is_a?(String) && id.match?(UUID) }
      ids = @listing_ids.map(&:downcase)
      return failure([ "Select between 1 and 100 distinct listings to rerank." ]) unless ids.uniq.size == ids.size
      return failure([ "Some search listings are no longer available. Search again." ]) unless JobBoardListing.where(id: ids).count == ids.size
      input = { "keyword" => @keyword.strip, "listing_ids" => ids }
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
