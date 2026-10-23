# Successful role checks apply only to their owner and are invalidated by legacy edits.
require "rails_helper"

RSpec.describe CareerLibrary::RecordScreeningService do
  let(:user) { create(:user) }

  it "applies only allowed role fields owned by the task user, idempotently" do
    experience = create(:experience, user: user)
    role = experience.roles.first
    foreign = create(:experience).roles.first
    reports = [role, foreign].map do |record|
      { "record_type" => "experience_role", "record_id" => record.id,
        "fields" => %w[title description start_date company] }
    end
    2.times { expect(described_class.call(user: user, reports: reports)).to be_success }
    expect(role.reload.screened_fields).to eq(%w[title description])
    expect(foreign.reload.screened_fields).to eq([])
  end

  it "invalidates changed canonical role text through the legacy single-role editor" do
    experience = create(:experience, user: user)
    role = experience.roles.first.tap { |item| item.update!(description: "Checked", screened_fields: %w[title description]) }
    result = Experiences::UpdateExperienceService.call(experience: experience, attributes: {title: "New title"})
    expect(result).to be_success
    expect(role.reload.title).to eq("New title")
    expect(role.screened_fields).to eq(["description"])
  end
end
