# Description: A user's choice not to answer one requirement of one job.
FactoryBot.define do
  factory :job_gap_dismissal do
    job
    requirement { "Experience with Kubernetes" }
  end
end
