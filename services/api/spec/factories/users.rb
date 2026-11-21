# Description: User factory with a unique email and a valid password. Users are verified and on
# an active trial by default; use :trial_ended for an account whose free week is over, and
# create(:billing_subscription, user: user) to make one a paying subscriber.
FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@example.com" }
    password { "a quiet orchard after rain" }
    name { "Test User" }
    confirmed_at { 30.days.ago }
    trial_ends_at { 7.days.from_now if confirmed_at }

    trait :trial_ended do
      trial_ends_at { 1.day.ago }
    end
  end
end
