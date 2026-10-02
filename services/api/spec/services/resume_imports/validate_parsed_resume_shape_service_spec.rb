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
end
