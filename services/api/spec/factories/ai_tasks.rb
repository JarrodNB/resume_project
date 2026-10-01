# Description: AI task factory (queued gap analysis by default).
FactoryBot.define do
  factory :ai_task do
    user
    task_type { "analyze_gaps" }
    status { "queued" }
  end
end
