# Description: Job profile factory (unapplied by default).
FactoryBot.define do
  factory :job do
    user
    title { "AI Engineer" }
    company { "Example AI" }
    requirements { [ "Python", "LLM application experience" ] }
  end
end
