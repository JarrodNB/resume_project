# Description: Revoked JWT factory.
FactoryBot.define do
  factory :jwt_denylist do
    sequence(:jti) { |n| "jti-#{n}" }
    exp { 1.day.from_now }
  end
end
