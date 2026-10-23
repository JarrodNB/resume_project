# Exercises ordered role storage, bounded fields, ownership integrity and parent cleanup.
require "rails_helper"

RSpec.describe "Experience roles" do
  let(:experience) { create(:experience) }

  def check_constraints!
    ActiveRecord::Base.connection.execute("SET CONSTRAINTS ALL IMMEDIATE")
  end

  it "keeps source order and permits shared and role-specific highlights" do
    second = experience.roles.create!(title: "Developer", position: 1)
    first = experience.roles.first.tap { |role| role.update!(title: "Lead") }
    shared = experience.highlights.create!(content: "Across both titles")
    owned = experience.highlights.create!(content: "Role detail", experience_role: second, position: 1)
    expect(experience.reload.roles.pluck(:id)).to eq([ first.id, second.id ])
    expect(shared.experience_role_id).to be_nil
    expect(owned.experience_role_id).to eq(second.id)
    check_constraints!
  end

  it "rejects cross-entry ownership at both validation and database seams" do
    other = create(:experience)
    role = other.roles.first
    highlight = experience.highlights.create!(content: "Original")
    highlight.experience_role = role
    expect(highlight).not_to be_valid
    expect(highlight.errors[:experience_role]).to be_present
    expect do
      ActiveRecord::Base.transaction(requires_new: true) do
        highlight.update_columns(experience_role_id: role.id)
        check_constraints!
      end
    end.to raise_error(ActiveRecord::InvalidForeignKey)
  end

  it "enforces bounded positions and uniqueness even without model validation" do
    expect do
      ActiveRecord::Base.transaction(requires_new: true) do
        experience.roles.create!(title: "Duplicate", position: 0)
          ActiveRecord::Base.connection.execute("SET CONSTRAINTS experience_roles_position_unique IMMEDIATE")
      end
    end.to raise_error(ActiveRecord::RecordNotUnique)
    role = experience.roles.build(title: "Too many", position: TextLimits::MAX_ROLES_PER_EXPERIENCE)
    expect(role).not_to be_valid
    expect do
      ActiveRecord::Base.transaction(requires_new: true) { role.save!(validate: false) }
    end.to raise_error(ActiveRecord::StatementInvalid, /experience_role_position_bounds/)
    expect(experience.roles.build(title: "x" * (TextLimits::SHORT + 1), position: 1)).not_to be_valid
    expect(experience.roles.build(title: "Valid", description: "x" * (TextLimits::PROSE + 1), position: 1)).not_to be_valid
  end

  it "counts unsaved roles toward the entry cap" do
    (TextLimits::MAX_ROLES_PER_EXPERIENCE + 1).times do |position|
      experience.roles.build(title: "Title", position: position)
    end
    expect(experience).not_to be_valid
    expect(experience.errors[:roles]).to include("can contain up to 20 titles")
  end

  it "deletes roles and stable bullets when the experience or its user is deleted" do
    [ :experience, :user ].each do |owner|
      entry = Experiences::CreateExperienceService.call(user: create(:user), attributes: {
        company: "Acme", title: "Engineer"
      }, highlights: [ "Owned" ]).value
      role_id = entry.roles.first.id
      highlight_id = entry.highlights.first.id
      (owner == :user ? entry.user : entry).destroy!
      check_constraints!
      expect(ExperienceRole.exists?(role_id)).to be(false)
      expect(ExperienceHighlight.exists?(highlight_id)).to be(false)
    end
  end

  it "refuses direct role deletion while bullets still belong to it" do
    role = experience.roles.first
    bullet = experience.highlights.create!(content: "Owned achievement", experience_role: role)
    expect(role.destroy).to be(false)
    expect(role.errors[:base]).to be_present
    expect(bullet.reload.experience_role_id).to eq(role.id)
    expect(ExperienceRole.exists?(role.id)).to be(true)
  end
end
