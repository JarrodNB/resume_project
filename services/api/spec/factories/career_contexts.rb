# Description: Career career context factory (an answer the user added from a gap).
FactoryBot.define do
  factory :career_context do
    user
    requirement { "Experience with Kubernetes" }
    response { "I used Kubernetes at Acme for two years" }
  end
end
