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
end
