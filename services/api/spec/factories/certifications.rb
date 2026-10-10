# Description: Independent career library certification factory.
# Index: certification factory
FactoryBot.define do
  factory :certification do
    user
    name { "AWS Solutions Architect" }
    issuer { "Amazon Web Services" }
    issued_date { Date.new(2024, 1, 1) }
  end
end
