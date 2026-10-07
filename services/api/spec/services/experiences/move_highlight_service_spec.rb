# Description: Moving highlights within a role and between roles, with renumbered positions.
require "rails_helper"

RSpec.describe Experiences::MoveHighlightService do
  let(:user) { create(:user) }
  let(:source) { create(:experience, user: user) }
  let(:target) { create(:experience, user: user) }
  let!(:source_highlights) do
    %w[A B C].each_with_index.map { |content, position| create(:experience_highlight, experience: source, content: content, position: position) }
  end
  let!(:target_highlights) do
    %w[X Y].each_with_index.map { |content, position| create(:experience_highlight, experience: target, content: content, position: position) }
  end

  def contents_and_positions(experience)
    experience.highlights.reload.pluck(:content, :position)
  end

  it "reorders a highlight within its own role" do
    result = described_class.call(highlight: source_highlights.first, experience: source, position: 2)

    expect(result).to be_success
    expect(contents_and_positions(source)).to eq([ [ "B", 0 ], [ "C", 1 ], [ "A", 2 ] ])
  end

  it "moves a highlight into another role, keeping its id and renumbering both roles" do
    moved = source_highlights.second
    result = described_class.call(highlight: moved, experience: target, position: 1)

    expect(result).to be_success
    expect(result.value).to eq(target)
    expect(contents_and_positions(target)).to eq([ [ "X", 0 ], [ "B", 1 ], [ "Y", 2 ] ])
    expect(contents_and_positions(source)).to eq([ [ "A", 0 ], [ "C", 1 ] ])
    expect(moved.reload.experience_id).to eq(target.id)
  end

  it "puts the highlight last when the position is past the end" do
    described_class.call(highlight: source_highlights.first, experience: target, position: 99)

    expect(contents_and_positions(target)).to eq([ [ "X", 0 ], [ "Y", 1 ], [ "A", 2 ] ])
  end

  it "gives the same result when run twice" do
    2.times { described_class.call(highlight: source_highlights.first, experience: target, position: 0) }

    expect(contents_and_positions(target)).to eq([ [ "A", 0 ], [ "X", 1 ], [ "Y", 2 ] ])
    expect(contents_and_positions(source)).to eq([ [ "B", 0 ], [ "C", 1 ] ])
  end

  it "rejects a move onto a role that already has 40 bullets" do
    full = create(:experience, user: user)
    create_list(:experience_highlight, TextLimits::MAX_HIGHLIGHTS_PER_ROLE, experience: full)
    moved = source_highlights.first

    result = described_class.call(highlight: moved, experience: full, position: 0)

    expect(result).not_to be_success
    expect(result.errors).to eq([ "You can save up to #{TextLimits::MAX_HIGHLIGHTS_PER_ROLE} bullets on a role" ])
    expect(moved.reload.experience).to eq(source)
  end

  it "still reorders a bullet inside a role that already has 40" do
    create_list(:experience_highlight, TextLimits::MAX_HIGHLIGHTS_PER_ROLE - source_highlights.size, experience: source)

    result = described_class.call(highlight: source_highlights.first, experience: source, position: TextLimits::MAX_HIGHLIGHTS_PER_ROLE - 1)

    expect(result).to be_success
    expect(source_highlights.first.reload.position).to eq(TextLimits::MAX_HIGHLIGHTS_PER_ROLE - 1)
  end

  it "rejects a negative position or another user's role" do
    negative = described_class.call(highlight: source_highlights.first, experience: target, position: -1)
    other_user = described_class.call(highlight: source_highlights.first, experience: create(:experience), position: 0)

    expect(negative.errors).to eq([ "Position can't be negative" ])
    expect(other_user.errors).to eq([ "Only your own entries can be changed" ])
    expect(contents_and_positions(source).map(&:first)).to eq(%w[A B C])
  end
end
