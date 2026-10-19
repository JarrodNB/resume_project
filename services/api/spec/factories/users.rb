# Description: User factory with a unique email and a valid password.
FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@example.com" }
    password { "a quiet orchard after rain" }
    name { "Test User" }
  end
end
