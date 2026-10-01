# Description: Career library education factory.
FactoryBot.define do
  factory :education do
    user
    institution { "State University" }
    degree { "BSc" }
    field_of_study { "Computer Science" }
  end
end
