# Description: User factory with a unique email and a valid password. Users are established
# accounts by default; use :new_account for the lower first-week AI limits.
FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@example.com" }
    password { "a quiet orchard after rain" }
    name { "Test User" }
    confirmed_at { 30.days.ago }

    trait :new_account do
      confirmed_at { Time.current }
    end
  end
end
