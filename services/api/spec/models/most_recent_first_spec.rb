# Description: Career library entries are listed most recent first, whatever order they were added in.
require "rails_helper"

RSpec.describe MostRecentFirst do
  let(:user) { create(:user) }

  it "lists current roles first, then finished roles by end date, then undated roles" do
    create(:experience, user: user, title: "Army", start_date: Date.new(2012, 6, 1), end_date: Date.new(2016, 6, 1), position: 0)
    create(:experience, user: user, title: "Undated", start_date: nil, end_date: nil, position: 1)
    create(:experience, user: user, title: "Developer", start_date: Date.new(2019, 1, 1), end_date: Date.new(2026, 9, 1), position: 2)
    create(:experience, user: user, title: "Current", start_date: Date.new(2025, 1, 1), end_date: nil, position: 3)
    create(:experience, user: user, title: "Tutor", start_date: Date.new(2018, 8, 1), end_date: Date.new(2018, 12, 1), position: 4)

    expect(user.experiences.map(&:title)).to eq(%w[Current Developer Tutor Army Undated])
  end

  it "orders projects and educations the same way" do
    create(:project, user: user, name: "Old", start_date: Date.new(2015, 1, 1), end_date: Date.new(2016, 1, 1))
    create(:project, user: user, name: "Ongoing", start_date: Date.new(2020, 1, 1), end_date: nil)
    create(:education, user: user, institution: "School", start_date: Date.new(2008, 1, 1), end_date: Date.new(2012, 1, 1))
    create(:education, user: user, institution: "University", start_date: Date.new(2012, 1, 1), end_date: Date.new(2016, 1, 1))

    expect(user.projects.pluck(:name)).to eq(%w[Ongoing Old])
    expect(user.educations.pluck(:institution)).to eq(%w[University School])
  end
end
