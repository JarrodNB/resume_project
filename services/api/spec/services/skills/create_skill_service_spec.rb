# Description: Adding a skill to a user's career library, including two requests arriving together.
require "rails_helper"

RSpec.describe Skills::CreateSkillService do
  let(:user) { create(:user) }

  before { allow(CareerLibrary::SyncLibraryEmbeddingsJob).to receive(:perform_later) }

  it "adds the skill after the user's other skills" do
    create(:skill, user: user, position: 4)

    result = described_class.call(user: user, attributes: { name: "Ruby" })

    expect(result).to be_success
    expect(result.value.position).to eq(5)
    expect(CareerLibrary::SyncLibraryEmbeddingsJob).to have_received(:perform_later).with(user.id)
  end

  it "reports a duplicate name with the existing capitalization" do
    create(:skill, user: user, name: "Ruby")

    result = described_class.call(user: user, attributes: { name: "ruby" })

    expect(result.errors).to eq([ "You already have a skill called Ruby" ])
  end

  it "reports a duplicate name instead of raising when a twin request saves between validation and insert" do
    # Skipping validation stands in for the uniqueness check having passed before the twin committed.
    allow_any_instance_of(Skill).to receive(:save).and_wrap_original do |original, *|
      create(:skill, user: user, name: "Ruby")
      original.call(validate: false)
    end

    result = described_class.call(user: user, attributes: { name: "Ruby" })

    expect(result).not_to be_success
    expect(result.errors).to eq([ "You already have a skill called Ruby" ])
  end

  it "takes the user lock so positions and the size limit are checked one request at a time" do
    allow(user).to receive(:with_lock).and_call_original

    described_class.call(user: user, attributes: { name: "Ruby" })

    expect(user).to have_received(:with_lock)
  end
end
