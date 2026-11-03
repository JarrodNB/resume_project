# Description: A user's default resume section order is a full list, or empty for the standard one.
require "rails_helper"

RSpec.describe User do
  let(:user) { create(:user) }
  let(:rearranged) { %w[skills summary experience projects education certifications] }

  it "starts with the standard order" do
    expect(user.ordered_resume_section_types).to eq(ResumeSection::ORDERABLE_TYPES)
  end

  it "returns a saved order" do
    user.update!(resume_section_order: rearranged)

    expect(user.reload.ordered_resume_section_types).to eq(rearranged)
  end

  it "adds a section type that was created after the order was saved" do
    user.update_column(:resume_section_order, %w[skills summary])

    expect(user.ordered_resume_section_types).to eq(%w[skills summary experience projects education certifications])
  end

  it "rejects contact, repeats, and missing sections" do
    [ [ "contact", *ResumeSection::ORDERABLE_TYPES ], rearranged.first(5), [ *rearranged.first(5), "skills" ] ].each do |order|
      user.resume_section_order = order

      expect(user).not_to be_valid
      expect(user.errors[:resume_section_order]).to be_present
    end
  end
end
