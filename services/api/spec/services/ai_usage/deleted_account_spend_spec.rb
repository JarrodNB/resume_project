# Description: Deleting an account keeps its AI spend as anonymous daily totals, so the site-wide trial budget still counts it.
require "rails_helper"

RSpec.describe "AI spend of deleted accounts" do
  let(:password) { "a quiet orchard after rain" }
  let(:user) { create(:user) }

  def delete_account(account = user) = Accounts::DeleteAccountService.call(user: account, current_password: password)

  def embedding_request(account, **attributes)
    AiEmbeddingRequest.create!(user: account, model: "text-embedding-3-small", purpose: "career_library", **attributes)
  end

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
end
