# Shared provider snapshots for catalogue and import tests.
FactoryBot.define do
  factory :job_board_listing do
    sequence(:provider_id) { |number| 10_000 + number }
    payload { { "title" => "Engineer", "location" => "US" } }
  end
end
