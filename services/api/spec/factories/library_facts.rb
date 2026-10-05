# Description: Career library fact factory (an answer the user added from a gap).
FactoryBot.define do
  factory :library_fact do
    user
    requirement { "Experience with Kubernetes" }
    response { "I used Kubernetes at Acme for two years" }
  end
end
