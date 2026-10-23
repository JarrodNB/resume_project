# Builds canonical experience roles while preserving convenient single-role factory inputs.
FactoryBot.define do
  factory :experience do
    user
    company { "Acme Corp" }
    transient do
      title { "Software Engineer" }
      start_date { Date.new(2022, 1, 1) }
      end_date { nil }
    end
    after(:build) do |experience, evaluator|
      if experience.roles.empty?
        experience.roles.build(title: evaluator.title, start_date: evaluator.start_date,
                               end_date: evaluator.end_date, position: 0)
      end
    end
  end
end
