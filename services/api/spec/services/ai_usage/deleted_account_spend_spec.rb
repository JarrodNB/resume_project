# Description: Deleting an account keeps its AI spend as anonymous daily totals, so the site-wide trial budget still counts it.
require "rails_helper"

RSpec.describe "AI spend of deleted accounts" do
  let(:password) { "a quiet orchard after rain" }
  let(:user) { create(:user) }

  def delete_account(account = user) = Accounts::DeleteAccountService.call(user: account, current_password: password)

  def embedding_request(account, **attributes)
    AiEmbeddingRequest.create!(user: account, model: "text-embedding-3-small", purpose: "career_library", **attributes)
  end

  around { |example| travel_to(Time.utc(2026, 11, 26, 12)) { example.run } }

  it "still counts the spend of a deleted trial account toward today's site budget" do
    create(:ai_task, user: user, cost_microdollars: 100_000)
    create(:ai_task, user: user, cost_microdollars: 50_000, counts_toward_trial_budget: false)
    embedding_request(user, cost_microdollars: 20_000)
    expect(AiUsage::SiteDailySpend.known_microdollars).to eq(120_000)

    expect(delete_account).to be_success

    expect(User.exists?(user.id)).to be(false)
    expect(AiUsage::SiteDailySpend.known_microdollars).to eq(120_000)
  end

  it "keeps each day's total separately, with no user or content in the rows" do
    create(:ai_task, user: user, cost_microdollars: 7_000, created_at: 2.days.ago)
    create(:ai_task, user: user, cost_microdollars: 300)

    delete_account

    yesterday = DeletedAccountAiSpend.find_by!(spend_date: 2.days.ago.utc.to_date, counts_toward_trial_budget: true)
    expect(yesterday).to have_attributes(cost_microdollars: 7_000, request_count: 1)
    expect(DeletedAccountAiSpend.column_names).to match_array(%w[id spend_date counts_toward_trial_budget cost_microdollars request_count created_at updated_at])
  end

  it "adds up several deleted accounts on the same day" do
    other = create(:user)
    create(:ai_task, user: user, cost_microdollars: 100)
    create(:ai_task, user: other, cost_microdollars: 250)

    delete_account
    delete_account(other)

    expect(DeletedAccountAiSpend.where(spend_date: Time.now.utc.to_date, counts_toward_trial_budget: true).sum(:cost_microdollars)).to eq(350)
    expect(DeletedAccountAiSpend.where(spend_date: Time.now.utc.to_date).count).to eq(1)
  end

  it "keeps nothing when the account is not deleted" do
    create(:ai_task, user: user, cost_microdollars: 100)

    result = Accounts::DeleteAccountService.call(user: user, current_password: "wrong password here")

    expect(result).not_to be_success
    expect(DeletedAccountAiSpend.count).to eq(0)
    expect(user.ai_tasks.count).to eq(1)
  end

  it "keeps the spend of an account removed by the unverified-account cleanup too" do
    stale = create(:user)
    create(:ai_task, user: stale, cost_microdollars: 40)

    stale.destroy!

    expect(DeletedAccountAiSpend.sum(:cost_microdollars)).to eq(40)
  end

  it "keeps the totals for several days and both budget classes, adding embedding costs and skipping unknown ones" do
    create(:ai_task, user: user, cost_microdollars: 5, created_at: 3.days.ago)
    create(:ai_task, user: user, cost_microdollars: 7, counts_toward_trial_budget: false, created_at: 3.days.ago)
    create(:ai_task, user: user, cost_microdollars: 11)
    embedding_request(user, cost_microdollars: 13)
    embedding_request(user, cost_microdollars: nil)
    embedding_request(user, cost_microdollars: 17, counts_toward_trial_budget: false, created_at: 3.days.ago)

    delete_account

    totals = DeletedAccountAiSpend.order(:spend_date, :counts_toward_trial_budget).pluck(:spend_date, :counts_toward_trial_budget, :cost_microdollars, :request_count)
    old_day, today = 3.days.ago.utc.to_date, Time.now.utc.to_date
    expect(totals).to eq([ [ old_day, false, 24, 2 ], [ old_day, true, 5, 1 ], [ today, true, 24, 3 ] ])
  end

  it "locks the embedding receipts before reading them, so a charge being finalized is not lost" do
    embedding_request(user, cost_microdollars: 13)
    statements = []
    callback = ->(*, payload) { statements << payload[:sql] }

    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { delete_account }

    expect(statements.grep(/FROM "ai_embedding_requests".*FOR UPDATE/m)).not_to be_empty
  end

  it "keeps nothing when the deletion itself fails part way" do
    create(:ai_task, user: user, cost_microdollars: 100)
    create(:resume, user: user)
    allow_any_instance_of(Resume).to receive(:destroy).and_raise(ActiveRecord::RecordNotDestroyed)

    result = delete_account

    expect(result).not_to be_success
    expect(DeletedAccountAiSpend.count).to eq(0)
    expect(user.ai_tasks.count).to eq(1)
  end
end
