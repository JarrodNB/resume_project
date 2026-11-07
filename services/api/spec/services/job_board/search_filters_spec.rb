# Check provider filter validation and cache canonicalization without Rails or HTTP.
require "spec_helper"
require_relative "../../../app/services/job_board/search_filters"

RSpec.describe JobBoard::SearchFilters do
  it "rejects malformed filters before canonicalization" do
    invalid_company = "\xFF".dup.force_encoding(Encoding::UTF_8)
    [ nil, [], { unknown: nil }, { max_age: "1y" }, { city_id: -1 },
      { city_id: 1, state_id: 2 }, { city_id: "1" }, { state_id: 2_147_483_648 },
      { remote_type: "onsite" }, { minimum_salary: 0 }, { minimum_salary: 1.5 },
      { minimum_salary: 1_000_000_001 }, { include_undisclosed_salaries: "false" },
      { company_name: "bad\nname" }, { company_name: "x" * 201 },
      { company_name: invalid_company }, { company_name: 42 },
      { employment_types: [ "bad" ] }, { employment_types: "FULL_TIME" },
      { sort_by: "salary" } ].each do |input|
      expect(described_class.normalize(input)).to be_nil, "accepted #{input.inspect}"
    end
  end

  it "canonicalizes equivalent selections without changing the submitted filters" do
    input = { max_age: "7d", city_id: 1, employment_types: %w[CONTRACT FULL_TIME CONTRACT],
      company_name: "  Acme   Labs  ", sort_by: "relevance", minimum_salary: 1,
      include_undisclosed_salaries: false }
    original = Marshal.load(Marshal.dump(input))
    normalized = described_class.normalize(input)
    expect(normalized).to eq(company_name: "acme labs", city_id: 1,
      employment_types: %w[FULL_TIME CONTRACT], max_age: "7d", minimum_salary: 1,
      include_undisclosed_salaries: false, sort_by: "relevance")
    expect(normalized.keys).to eq(normalized.keys.sort)
    expect(input).to eq(original)
    expect(described_class.parameters(normalized)).to include(employment_type: "FULL_TIME,CONTRACT",
      salary: 1, require_salary: "true")
  end

  it "omits unrestricted defaults and accepts numeric boundaries" do
    expect(described_class.normalize(max_age: nil, company_name: " ", employment_types: [],
      include_undisclosed_salaries: false, sort_by: "published")).to eq({})
    expect(described_class.normalize(state_id: 2_147_483_647, minimum_salary: 1_000_000_000,
      include_undisclosed_salaries: true)).to eq(state_id: 2_147_483_647, minimum_salary: 1_000_000_000)
  end
end
