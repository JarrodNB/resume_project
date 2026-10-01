# Description: AI task factory (queued gap analysis by default).
# Index:
#   - :completed_resume_parse trait: a finished parse_resume task with a small parsed resume
FactoryBot.define do
  factory :ai_task do
    user
    task_type { "analyze_gaps" }
    status { "queued" }

    trait :completed_resume_parse do
      task_type { "parse_resume" }
      status { "completed" }
      completed_at { Time.current }
      result do
        { "parsed_resume" => { "contact" => { "full_name" => "Jane Doe" }, "experiences" => [], "skills" => [] } }
      end
    end
  end
end
