# Description: Resume factory: a resume tailored to one of the same user's jobs.
FactoryBot.define do
  factory :resume do
    user
    title { "Tailored resume" }
    job { association :job, user: user }
  end
end
