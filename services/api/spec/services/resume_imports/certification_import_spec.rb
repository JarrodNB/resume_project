# Description: Reviewed certification imports preserve education and handle legacy and duplicate payloads.
# Index: old payload, credential merge/date matching, validation rollback examples
require "rails_helper"

RSpec.describe ResumeImports::ImportParsedResumeService do
  let(:user) { create(:user) }
  let(:task) { create(:ai_task, :completed_resume_parse, user: user) }
  let(:credential) { { "name" => "AWS", "issuer" => "Amazon", "issued_date" => "2024-02", "credential_id" => "123" } }

  it "keeps legacy parsing results importable without reclassifying existing education" do
    education = create(:education, user: user, degree: "AWS certification")
    expect(described_class.call(ai_task: task, parsed_resume: { "educations" => [] })).to be_success
    expect(user.educations.sole).to eq(education)
    expect(user.certifications).to be_empty
  end

  it "imports stated credentials separately, merges repeats and distinguishes later issuance" do
    education = create(:education, user: user)
    expect(described_class.call(ai_task: task, parsed_resume: { "certifications" => [ credential ] })).to be_success
    expect(user.certifications.sole).to have_attributes(issued_date: Date.new(2024, 2, 1), expiry_date: nil, credential_url: nil)
    second = create(:ai_task, :completed_resume_parse, user: user)
    items = [ credential.merge("name" => " aws ", "description" => "Exam passed"), credential.merge("issued_date" => "2025") ]
    expect(described_class.call(ai_task: second, parsed_resume: { "certifications" => items })).to be_success
    expect(user.certifications.count).to eq(2)
    expect(user.certifications.find_by!(issued_date: Date.new(2024, 2, 1)).description).to eq("Exam passed")
    expect(second.reload.result["import_summary"]).to eq("added" => 1, "merged" => 1)
    expect(described_class.call(ai_task: second, parsed_resume: { "certifications" => items })).not_to be_success
    expect(user.certifications.count).to eq(2)
    expect(user.educations.sole).to eq(education)
  end

  it "rejects malformed or invalid credentials without partial imports" do
    expect(described_class.call(ai_task: task, parsed_resume: { "certifications" => "AWS" })).not_to be_success
    result = described_class.call(ai_task: task, parsed_resume: { "certifications" => [ credential, { "issuer" => "Amazon" } ] })
    expect(result).not_to be_success
    expect(user.certifications).to be_empty
    expect(task.reload).not_to be_accepted
  end
  it "preserves year, month and exact-day credential date precision" do
    items = %w[2026 2026-10 2026-10-31].each_with_index.map do |expiry, index|
      { "name" => "Credential #{index}", "issued_date" => expiry, "expiry_date" => expiry }
    end
    expect(described_class.call(ai_task: task, parsed_resume: { "certifications" => items })).to be_success
    %w[year month day].each_with_index do |precision, index|
      credential = user.certifications.find_by!(name: "Credential #{index}")
      expect(credential.issued_date_precision).to eq(precision)
      expect(credential.expiry_date_precision).to eq(precision)
    end
    expect(user.certifications.find_by!(name: "Credential 2").expiry_date).to eq(Date.new(2026, 10, 31))
    texts = CareerLibrary::BuildEmbeddingTextsService.call(user: user).value.index_by { |entry| entry[:source_id] }
    items.each_with_index do |item, index|
      credential = user.certifications.find_by!(name: "Credential #{index}")
      expect(texts.fetch(credential.id)[:content]).to include("Expiry date: #{item['expiry_date']}")
    end
    expect(texts.fetch(user.certifications.find_by!(name: "Credential 0").id)[:content]).not_to include("2026-01")
  end

  it "keeps precision when merging a previously missing expiry" do
    existing = create(:certification, user: user, name: "AWS", issuer: "Amazon", issued_date: Date.new(2024, 2, 1))
    expect(described_class.call(ai_task: task, parsed_resume: { "certifications" => [ credential.merge("expiry_date" => "2026") ] })).to be_success
    expect(existing.reload).to have_attributes(expiry_date: Date.new(2026, 1, 1), expiry_date_precision: "year")
  end

  it "preserves a valid issue date when the companion expiry is invalid" do
    item = credential.merge("issued_date" => "2024-02-29", "expiry_date" => "2026-02-30")
    expect(described_class.call(ai_task: task, parsed_resume: { "certifications" => [ item ] })).to be_success
    expect(user.certifications.sole).to have_attributes(issued_date: Date.new(2024, 2, 29), issued_date_precision: "day", expiry_date: nil)
  end

end
