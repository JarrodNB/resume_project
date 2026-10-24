# Checks the offer gate through owner-scoped library narratives, not metadata.
require "rails_helper"

RSpec.describe ResumeTailoring::ResumePageEligibilityService do
  let(:user) { create(:user) }

  it "requires 700 narrative words and ignores numeric tokens" do
    user.update!(summary: "Led " * 699 + "2024 42 10.5")
    expect(described_class.call(user: user).value).to be(false)
    user.update!(summary: "Led " * 700)
    expect(described_class.call(user: user).value).to be(true)
  end

  it "counts descriptions, accomplishments and fact responses across the library" do
    user.update!(summary: "Led " * 100)
    role = create(:experience, user: user, description: "Led " * 100)
    create(:experience_highlight, experience: role, content: "Led " * 100)
    create(:project, user: user, description: "Led " * 100)
    create(:education, user: user, description: "Led " * 100)
    create(:certification, user: user, description: "Led " * 100)
    create(:library_fact, user: user, response: "Led " * 100)
    expect(described_class.call(user: user).value).to be(true)
  end

  it "excludes metadata and never counts another owner's library" do
    other = create(:user, summary: "Led " * 700)
    create(:experience, user: other, description: "Led " * 700)
    user.update!(name: "Name " * 40, location: "Location " * 20)
    10.times { |i| create(:skill, user: user, name: "Skill #{i} " + "Metadata " * 15) }
    10.times { create(:project, user: user, name: "Project " * 25, role: "Lead " * 40) }
    expect(described_class.call(user: user).value).to be(false)
  end
end
