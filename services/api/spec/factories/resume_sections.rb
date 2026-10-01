# Description: Resume section factory (summary section by default).
FactoryBot.define do
  factory :resume_section do
    resume
    section_type { "summary" }
    title { "Summary" }
    content { { "text" => "Engineer focused on LLM applications." } }
  end
end
