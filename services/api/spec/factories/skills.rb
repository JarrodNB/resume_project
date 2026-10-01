# Description: Career library skill factory.
FactoryBot.define do
  factory :skill do
    user
    sequence(:name) { |n| "Skill #{n}" }
    category { "Languages" }
  end
end
