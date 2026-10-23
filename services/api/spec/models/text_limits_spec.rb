# Description: User-written text is rejected when it is over the shared caps, and a normal
# bullet is kept. Count caps stop another create once the library is full.
require "rails_helper"

RSpec.describe TextLimits do
  it "accepts a bullet at the cap and rejects one character over it" do
    experience = create(:experience)
    highlight = experience.highlights.build(content: "a" * TextLimits::BULLET, position: 0)

    expect(highlight).to be_valid

    highlight.content = "a" * (TextLimits::BULLET + 1)

    expect(highlight).not_to be_valid
    expect(highlight.errors.full_messages).to include(
      "Content is too long (maximum is #{TextLimits::BULLET} characters)"
    )
  end

  it "rejects a description one character over the prose cap" do
    experience = build(:experience, description: "a" * (TextLimits::PROSE + 1))

    expect(experience).not_to be_valid
    expect(experience.errors.full_messages).to include(
      "Description is too long (maximum is #{TextLimits::PROSE} characters)"
    )
  end

  it "rejects a 51st role" do
    user = create(:user)
    create_list(:experience, TextLimits::MAX_EXPERIENCES, user: user)
    extra = build(:experience, user: user, company: "Extra", title: "Role")

    expect(extra.save).to be(false)
    expect(extra.errors.full_messages).to include("You can save up to #{TextLimits::MAX_EXPERIENCES} experience entries")
  end

  it "rejects a requirement that is too long" do
    job = build(:job, requirements: [ "a" * (TextLimits::BULLET + 1) ])

    expect(job).not_to be_valid
    expect(job.errors.full_messages).to include(
      "A requirement is too long (maximum is #{TextLimits::BULLET} characters)"
    )
  end
end
