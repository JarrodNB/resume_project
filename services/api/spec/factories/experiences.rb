# Description: Career library experience factory.
FactoryBot.define do
  factory :experience do
    user
    company { "Acme Corp" }
    title { "Software Engineer" }
    start_date { Date.new(2022, 1, 1) }
  end
end
