# Description: A user's answer to one requirement of one job.
FactoryBot.define do
  factory :job_gap_response do
    job
    requirement { "Experience with Kubernetes" }
    body { "I used Kubernetes at Acme for two years" }
  end
end
