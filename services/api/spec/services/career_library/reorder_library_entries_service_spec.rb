# Description: Reordering career library entries, rejecting incomplete orders, and repeat calls.
require "rails_helper"

RSpec.describe CareerLibrary::ReorderLibraryEntriesService do
  let(:user) { create(:user) }
  let!(:first) { create(:project, user: user, name: "First", position: 0) }
  let!(:second) { create(:project, user: user, name: "Second", position: 1) }
  let!(:third) { create(:project, user: user, name: "Third", position: 2) }

  it "sets each position to the entry's index in the new order" do
    result = described_class.call(records: user.projects, ordered_ids: [ third.id, first.id, second.id ])

    expect(result).to be_success
    expect(user.projects.reload.pluck(:name)).to eq(%w[Third First Second])
  end

  it "gives the same result when run twice" do
    2.times { described_class.call(records: user.projects, ordered_ids: [ second.id, third.id, first.id ]) }

    expect(user.projects.reload.pluck(:name, :position)).to eq([ [ "Second", 0 ], [ "Third", 1 ], [ "First", 2 ] ])
  end

  it "rejects an order that misses, repeats, or adds an entry" do
    someone_elses = create(:project)
    [
      [ first.id, second.id ],
      [ first.id, first.id, second.id ],
      [ first.id, second.id, third.id, someone_elses.id ]
    ].each do |ordered_ids|
      result = described_class.call(records: user.projects, ordered_ids: ordered_ids)

      expect(result).not_to be_success
      expect(result.errors).to eq([ "The new order must list each entry exactly once" ])
    end
    expect(user.projects.reload.pluck(:name)).to eq(%w[First Second Third])
  end
end
