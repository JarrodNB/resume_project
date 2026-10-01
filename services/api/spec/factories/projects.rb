# Description: Career library project factory.
FactoryBot.define do
  factory :project do
    user
    name { "Open source CLI tool" }
  end
end
