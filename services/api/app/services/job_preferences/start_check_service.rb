# Freeze one current catalogue listing and confirmed owner preferences before queue publication.
# Identical pending checks reuse admission; changed browser sources are rejected before paid work.
module JobPreferences
  class StartCheckService < ApplicationService
    def initialize(user:, listing_id:, expected_digest:, confirmed_revision:)
      @user, @listing_id, @expected_digest, @revision = user, listing_id, expected_digest, confirmed_revision
    end

    def call
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "check_job_preferences",
        resolve_existing: method(:resolve_existing), prepare_task: method(:prepare_task))
    end

    private

    def build_snapshot
      profile = @user.reload.job_preference_profile
      return failure([ "Confirm your job preferences before checking results." ]) unless profile && profile.confirmed_criteria.present?
      return failure([ "Your confirmed preferences changed. Reload them and check again." ]) unless profile.confirmed_revision == @revision
      listing = JobBoardListing.find_by(id: @listing_id)
      return failure([ "This listing is no longer available. Refresh your search results." ]) unless listing
      source = JobBoard::PreferenceListingSnapshot.new(listing)
      return failure([ "This listing changed. Refresh your search results before checking." ]) unless source.digest == @expected_digest
      criteria = profile.confirmed_criteria.map do |criterion|
        criterion.merge("trusted_generated" => generated_criterion?(criterion), "screened" => checked_criterion?(criterion))
      end
      @input = { "profile_id" => profile.id, "confirmed_revision" => profile.confirmed_revision,
        "criteria" => criteria, "listings" => [source.snapshot.merge("screened" => checked_listing?(listing.id, source.digest))] }
      return failure([ "These preferences and listing are too large to check." ]) if JSON.generate(@input).bytesize > 40_000
      success(@input)
    end

    def generated_criterion?(criterion)
      # Provenance is established from validated, completed Rails-owned output, never client flags.
      @user.ai_tasks.where(task_type: "elicit_job_preferences", status: "completed")
        .where("result @> ?", {criteria: [criterion]}.to_json).exists?
    end

    def checked_criterion?(criterion)
      prior_check = @user.ai_tasks.where(task_type: "check_job_preferences", status: "completed")
        .where("input @> ?", {criteria: [criterion]}.to_json).exists?
      prior_check || @user.ai_tasks.where(task_type: "elicit_job_preferences", status: %w[completed needs_user_input])
        .where("input @> ?", {criteria: [criterion.slice("text", "priority")]}.to_json).exists?
    end

    def checked_listing?(id, digest)
      @user.ai_tasks.where(task_type: "check_job_preferences", status: "completed")
        .where("input @> ?", {listings: [{id: id, source_digest: digest}]}.to_json).exists?
    end

    def resolve_existing
      result = build_snapshot
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
