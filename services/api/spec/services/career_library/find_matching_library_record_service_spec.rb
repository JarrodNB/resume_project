# Description: Matching career library records by their identifying fields.
require "rails_helper"

RSpec.describe CareerLibrary::FindMatchingLibraryRecordService do
  let(:user) { create(:user) }

  def find_match(record, candidates)
    described_class.call(record: record, candidates: candidates).value
  end

  it "matches experiences on company and title, ignoring case and extra whitespace" do
    existing = create(:experience, user: user, company: "Acme Corp", title: "Software Engineer")
    other = create(:experience, user: user, company: "Acme Corp", title: "Manager")

    record = Experience.new(user: user, company: "  acme   corp ", title: "SOFTWARE engineer")

    expect(find_match(record, [ other, existing ])).to eq(existing)
  end

  it "doesn't match when both start dates are set and differ" do
    existing = create(:experience, user: user, start_date: Date.new(2018, 1, 1))

    second_stint = Experience.new(user: user, company: existing.company, title: existing.title, start_date: Date.new(2022, 1, 1))
    undated = Experience.new(user: user, company: existing.company, title: existing.title, start_date: nil)

    expect(find_match(second_stint, [ existing ])).to be_nil
    expect(find_match(undated, [ existing ])).to eq(existing)
  end

  it "matches projects on name" do
    existing = create(:project, user: user, name: "Side Project")

    expect(find_match(Project.new(user: user, name: "side project"), [ existing ])).to eq(existing)
    expect(find_match(Project.new(user: user, name: "Other"), [ existing ])).to be_nil
  end

  it "matches educations on institution and degree; a blank degree only matches a blank degree" do
    with_degree = create(:education, user: user, institution: "State University", degree: "BSc")
    without_degree = create(:education, user: user, institution: "State University", degree: nil)

    expect(find_match(Education.new(user: user, institution: "State University", degree: "bsc"), [ without_degree, with_degree ]))
      .to eq(with_degree)
    expect(find_match(Education.new(user: user, institution: "State University", degree: ""), [ with_degree, without_degree ]))
      .to eq(without_degree)
  end

  it "never matches the record itself" do
    existing = create(:project, user: user)

    expect(find_match(existing, [ existing ])).to be_nil
  end
end
