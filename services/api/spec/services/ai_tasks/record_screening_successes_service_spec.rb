# Checks durable metadata validation and database integrity independently of task outcomes.
require "rails_helper"

RSpec.describe AiTasks::RecordScreeningSuccessesService do
  let(:task) { create(:ai_task) }
  let(:report) { { "content_digest" => "a" * 64, "policy_identity" => "b" * 64 } }

  it "inserts an exact decision once across separate tasks owned by the same account" do
    other_task = create(:ai_task, user: task.user)
    [ task, other_task ].each do |owner_task|
      expect(described_class.call(ai_task: owner_task, reports: [ report ])).to be_success
    end
    expect(task.user.screening_decisions.count).to eq(1)
  end

  it "returns validation failure without inserting part of a malformed batch" do
    result = described_class.call(ai_task: task, reports: [ report, report.merge("policy_identity" => "") ])
    expect(result).not_to be_success
    expect(task.user.screening_decisions).to be_empty
  end

  it "enforces required owner, exact digests and uniqueness even when model validation is bypassed" do
    attributes = report.merge("user_id" => task.user_id, "created_at" => Time.current)
    ScreeningDecision.insert_all!([ attributes ])
    [ attributes, attributes.merge("user_id" => nil), attributes.merge("user_id" => SecureRandom.uuid),
      attributes.merge("content_digest" => "invalid"), attributes.merge("policy_identity" => nil) ].each do |invalid|
      expect do
        ScreeningDecision.transaction(requires_new: true) { ScreeningDecision.insert_all!([ invalid ]) }
      end.to raise_error(ActiveRecord::StatementInvalid)
    end
    expect(ScreeningDecision.count).to eq(1)
  end
end
