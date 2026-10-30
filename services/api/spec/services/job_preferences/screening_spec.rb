# Verify reusable preference checks against exact owned criteria and bounded shared excerpts.
require "rails_helper"

RSpec.describe "Job preference screening approvals" do
  let(:user) { create(:user) }
  let(:listing) { create(:job_board_listing, payload: { title: "Engineer", description: "Remote work. " * 900 }) }
  before do
    allow(Shoryuken::Client).to receive_message_chain(:queues, :send_message)
    allow(ApiSchema.subscriptions).to receive(:trigger)
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 0, action: :save_draft,
      criteria: [ { text: "Remote work", priority: "must_have" } ])
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 1, action: :confirm)
  end

  def start(owner = user)
    JobPreferences::StartCheckService.call(user: owner, confirmed_revision: 2, listings: [ {
      listing_id: listing.id, expected_digest: JobBoard::PreferenceListingSnapshot.new(listing).digest
    } ]).value
  end

  def fingerprint(value) = Screening::RecordApprovalsService.field_fingerprint(value)

  def reports(task)
    criterion = task.input["criteria"].first
    source = task.input["listings"].first
    [ { "record_type" => "job_preference_criterion", "record_id" => criterion["id"],
        "fingerprints" => { "text" => fingerprint(criterion["text"]) } },
      { "record_type" => "job_board_listing", "record_id" => source["id"],
        "fingerprints" => { "passages" => fingerprint(source["passages"].pluck("text")) } } ]
  end

  def apply(task, receipts = reports(task))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "failed",
      "error_message" => "Writer unavailable", "record_screening" => receipts })
  end

  it "persists checks despite later generation failure and reuses them without prior-task inference" do
    task = start
    2.times { expect(apply(task)).to be_success }
    expect(user.job_preference_profile.reload.screened_criteria_sha256).to eq([ fingerprint("Remote work") ])
    expect(listing.reload.screened_sha256).to eq(reports(task).last["fingerprints"]["passages"])
    next_task = start
    expect(next_task.input["criteria"].first["screened"]).to be(true)
    expect(next_task.input["listings"].first["screened"]).to be(true)
  end

  it "shares exact listing checks across owners without sharing private criterion approvals" do
    apply(start)
    other = create(:user)
    JobPreferences::UpdateProfileService.call(user: other, expected_version: 0, action: :save_draft,
      criteria: [ { text: "Remote work", priority: "must_have" } ])
    JobPreferences::UpdateProfileService.call(user: other, expected_version: 1, action: :confirm)
    task = start(other)
    expect(task.input["listings"].first["screened"]).to be(true)
    expect(task.input["criteria"].first["screened"]).to be(false)
    Screening::RecordApprovalsService.call(user: other, ai_task: task, reports: reports(start(user)))
    expect(other.job_preference_profile.reload.screened_criteria_sha256).to be_empty
  end

  it "rejects edited criteria and listings, foreign tasks, missing and stale fingerprints" do
    task = start
    receipts = reports(task)
    user.job_preference_profile.update!(draft_criteria: [], confirmed_criteria: [])
    listing.update!(payload: { title: "Changed", description: "Office only" })
    apply(task, receipts)
    expect(user.job_preference_profile.reload.screened_criteria_sha256).to be_empty
    expect(listing.reload.screened_sha256).to be_nil
    Screening::RecordApprovalsService.call(user: create(:user), ai_task: task, reports: receipts)
    expect(listing.reload.screened_sha256).to be_nil
  end

  it "does not let a shorter excerpt approve passages it never screened" do
    task = start
    short = JobBoard::PreferenceListingSnapshot.new(listing).snapshot(max_text_bytes: 1200)
    task.update!(input: task.input.merge("listings" => [ short ]))
    apply(task)
    expect(listing.reload.screened_sha256).to be_nil
    expect(start.input["listings"].first["screened"]).to be(false)
  end

  it "treats changed text as unchecked even when a prior criterion fingerprint remains" do
    task = start
    apply(task)
    profile = user.job_preference_profile.reload
    criteria = profile.confirmed_criteria.map { |item| item.merge("text" => "New condition") }
    profile.update!(confirmed_criteria: criteria)
    expect(start.input["criteria"].first["screened"]).to be(false)
    listing.update!(payload: { title: "Different job", description: "Office only" })
    expect(start.input["listings"].first["screened"]).to be(false)
  end
end
