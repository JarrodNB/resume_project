# Description: Experience bullet point factory.
FactoryBot.define do
  factory :experience_highlight do
    experience
    content { "Shipped a feature used by 10,000 customers" }
    position { 0 }
  end
end
