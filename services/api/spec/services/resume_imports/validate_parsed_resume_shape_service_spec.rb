# Description: Structural checks on client-supplied ParsedResume JSON before it is imported.
require "rails_helper"

RSpec.describe ResumeImports::ValidateParsedResumeShapeService do
  it "accepts a well-formed parsed resume and stringifies its keys" do
    parsed_resume = { contact: { full_name: "Jane" }, experiences: [ { company: "Acme", highlights: [ "Built" ] } ] }

    result = described_class.call(parsed_resume: parsed_resume)

    expect(result).to be_success
    expect(result.value).to eq("contact" => { "full_name" => "Jane" },
                               "experiences" => [ { "company" => "Acme", "highlights" => [ "Built" ] } ])
  end

  it "accepts missing and null sections" do
    expect(described_class.call(parsed_resume: { "contact" => nil, "skills" => nil })).to be_success
  end

  it "rejects a parsed resume that isn't an object" do
    expect(described_class.call(parsed_resume: [ 1, 2 ]).errors).to eq([ "Parsed resume must be an object" ])
    expect(described_class.call(parsed_resume: "text").errors).to eq([ "Parsed resume must be an object" ])
  end

  it "rejects wrong section types" do
    parsed_resume = { "contact" => "Jane", "summary" => { "text" => "Hi" }, "experiences" => { "company" => "Acme" },
                      "skills" => [ "Ruby" ] }

    expect(described_class.call(parsed_resume: parsed_resume).errors).to eq([
      "contact must be an object", "summary must be a string",
      "experiences must be a list of objects", "skills must be a list of objects"
    ])
  end

  it "rejects wrong nested types" do
    parsed_resume = { "experiences" => [ { "highlights" => "Built" } ], "skills" => [ { "name" => 42 } ] }

    expect(described_class.call(parsed_resume: parsed_resume).errors).to eq([
      "experience highlights must be a list of strings", "skill names must be strings"
    ])
  end
  it "rejects malformed grouped roles and ambiguous flat fields" do
    invalid = [
      { "roles" => nil }, { "roles" => [] }, { "roles" => "Engineer" }, { "roles" => [ "Engineer" ] },
      { "roles" => [ { "title" => "Engineer", "highlights" => [ 12 ] } ] },
      { "roles" => [ { "title" => "Engineer", "is_current" => "false" } ] },
      { "roles" => [ { "title" => "Engineer" } ], "shared_highlights" => "Built systems" },
      { "roles" => [ { "title" => "Engineer" } ], "highlights" => [ "Ambiguous" ] },
      { "roles" => [ { "title" => "Engineer" } ], "title" => "Legacy" }
    ]
    invalid.each do |entry|
      result = described_class.call(parsed_resume: { "experiences" => [ entry ] })
      expect(result).not_to be_success, entry.inspect
    end
  end

  it "bounds each role and shared list while allowing the full 840-bullet entry" do
    role = { "title" => "Engineer", "highlights" => Array.new(40, "Built systems") }
    entry = { "roles" => Array.new(20) { role.deep_dup }, "shared_highlights" => Array.new(40, "Shared outcome") }
    expect(described_class.call(parsed_resume: { "experiences" => [ entry ] })).to be_success

    oversized = [
      entry.merge("roles" => Array.new(21) { role.deep_dup }),
      entry.merge("shared_highlights" => Array.new(41, "Shared outcome")),
      entry.merge("roles" => [ role.merge("highlights" => Array.new(41, "Built systems")) ]),
      { "title" => "Legacy", "highlights" => Array.new(41, "Built systems") }
    ]
    oversized.each do |item|
      expect(described_class.call(parsed_resume: { "experiences" => [ item ] })).not_to be_success
    end
  end
end
