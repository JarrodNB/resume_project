# Description: Resume factory. Base by default; use the :tailored trait for a job-specific resume.
FactoryBot.define do
  factory :resume do
    user
    title { "Base resume" }
    kind { "base" }

    trait :tailored do
      kind { "tailored" }
      job { association :job, user: user }
    end
  end
end
