# Section order preferences change only the signed-in user's default and owned resumes.
require "rails_helper"

RSpec.describe "Resume section order" do
  let(:user) { create(:user) }

  it "starts with the standard order and saves a new default without changing saved resumes" do
    resume = create(:resume, user: user)
    create(:resume_section, resume: resume, section_type: "summary", position: 0)
    result = execute_graphql(<<~GQL, user: user)
      mutation { updateProfile(input: { attributes: { resumeSectionOrder: [SKILLS, SUMMARY, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS] } }) {
        user { resumeSectionOrder } errors
      } }
    GQL

    expect(result.dig("data", "updateProfile", "errors")).to eq([])
    expect(result.dig("data", "updateProfile", "user", "resumeSectionOrder")).to eq(%w[SKILLS SUMMARY EXPERIENCE PROJECTS EDUCATION CERTIFICATIONS])
    expect(execute_graphql("{ me { resumeSectionOrder } }", user: create(:user)).dig("data", "me", "resumeSectionOrder")).to eq(ResumeSection::ORDERABLE_TYPES.map(&:upcase))
    expect(resume.reload.sections.map(&:position)).to eq([ 0 ])
  end

  it "rejects a default that moves contact" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { updateProfile(input: { attributes: { resumeSectionOrder: [CONTACT, SKILLS, SUMMARY, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS] } }) { errors } }
    GQL

    expect(result.dig("data", "updateProfile", "errors")).not_to be_empty
    expect(user.reload.resume_section_order).to eq([])
  end

  it "reorders an owned resume's sections and refuses another user's resume" do
    resume = create(:resume, user: user)
    contact = create(:resume_section, resume: resume, section_type: "contact", position: 0)
    summary = create(:resume_section, resume: resume, section_type: "summary", position: 1)
    skills = create(:resume_section, resume: resume, section_type: "skills", position: 2, content: { "items" => [] })
    other = create(:resume)
    query = <<~GQL
      mutation($id: ID!, $order: [ID!]) { updateResume(input: { id: $id, sections: [], sectionOrder: $order }) {
        resume { sections { id position } } errors
      } }
    GQL

    result = execute_graphql(query, user: user, variables: { id: resume.id, order: [ contact.id, skills.id, summary.id ] })
    expect(result.dig("data", "updateResume", "resume", "sections").map { |section| section["id"] }).to eq([ contact.id, skills.id, summary.id ])

    rejected = execute_graphql(query, user: user, variables: { id: other.id, order: [] })
    expect(rejected["errors"].first["message"]).to eq("Record not found")
  end
end
