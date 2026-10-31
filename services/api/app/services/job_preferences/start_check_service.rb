# Queue identities and fingerprints for up to 100 listings and confirmed preferences.
# Identical pending checks reuse admission; changed browser sources are rejected before paid work.
module JobPreferences
  class StartCheckService < ApplicationService
    MAX_LISTINGS = 100
    MAX_INPUT_BYTES = 180_000
    MAX_RESULT_BYTES = 160_000
    TEXT_BUDGET_BYTES = 100_000
    UUID = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

    def initialize(user:, confirmed_revision:, listings:)
      @user, @revision = user, confirmed_revision
      @listings = listings
    end

    def call
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "check_job_preferences",
        resolve_existing: method(:resolve_existing), prepare_task: method(:prepare_task))
    end

    private

    def build_command
      profile = @user.reload.job_preference_profile
      return failure([ "Confirm your job preferences before checking results." ]) unless profile && profile.confirmed_criteria.present?
      return failure([ "Your confirmed preferences changed. Reload them and check again." ]) unless profile.confirmed_revision == @revision
      return failure([ "Select between 1 and 100 loaded listings to check." ]) unless @listings.is_a?(Array) && @listings.size.between?(1, MAX_LISTINGS)
      requested = @listings.map { |item| item.to_h.symbolize_keys }
      return failure([ "Select distinct, valid loaded listings to check." ]) unless requested.all? { |item| item[:listing_id].is_a?(String) && item[:listing_id].match?(UUID) }
      requested.each { |item| item[:listing_id] = item[:listing_id].downcase }
      ids = requested.map { |item| item[:listing_id] }
      return failure([ "Select distinct, valid loaded listings to check." ]) unless ids.uniq.size == ids.size
      by_id = JobBoardListing.where(id: ids).index_by(&:id)
      return failure([ "This listing is no longer available. Refresh your search results." ]) unless by_id.size == ids.size
      byte_budget = [ TEXT_BUDGET_BYTES / ids.size, JobBoard::PreferenceListingSources::MAX_TEXT_BYTES ].min
      snapshots = requested.map do |item|
        source = JobBoard::PreferenceListingSources.new(by_id.fetch(item[:listing_id])).projection(max_text_bytes: byte_budget)
        return failure([ "This listing changed. Refresh your search results before checking." ]) unless source["source_digest"] == item[:expected_digest]
        return failure([ "A listing has no usable posting text. Refresh or narrow your search." ]) if source["passages"].empty?
        source.except("passages").merge("passages_sha256" =>
          Screening::RecordApprovalsService.field_fingerprint(source["passages"].pluck("text")))
      end
      Screening::RecordApprovalsService.import_legacy_preference_checks(user: @user, profile: profile)
      criteria = profile.confirmed_criteria.map do |criterion|
        criterion.slice("id", "priority").merge("text_sha256" => Screening::RecordApprovalsService.field_fingerprint(criterion["text"]))
      end
      @input = { "profile_id" => profile.id, "confirmed_revision" => profile.confirmed_revision,
        "criteria" => criteria, "listings" => snapshots }
      return failure([ "This check has too much listing text. Narrow your search or check fewer results." ]) if
        JSON.generate(@input).bytesize > MAX_INPUT_BYTES || largest_result_bytes > MAX_RESULT_BYTES
      success(@input)
    end

    # Bound the complete identity/probability result before any paid model work.
    def largest_result_bytes
      listings = @input["listings"].map do |source|
        { "id" => source["id"], "source_digest" => source["source_digest"], "truncated" => source["truncated"],
          "criteria" => @input["criteria"].map { |criterion| { "id" => criterion["id"], "probability" => 0.12345678901234567 } } }
      end
      JSON.generate({ "confirmed_revision" => @revision, "listings" => listings }).bytesize
    end

    def resolve_existing
      result = build_command
      return result unless result.success?
      task = @user.ai_tasks.where(task_type: "check_job_preferences", status: "queued", input: @input,
        created_at: AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago..).order(created_at: :desc).first
      success(task) if task
    end

    def prepare_task(task)
      task.input = @input
      success(task)
    end
  end
end
