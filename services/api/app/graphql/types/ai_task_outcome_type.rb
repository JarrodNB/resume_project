# Safe task notice fields. Raw task input, result and provider errors stay off the feed.
module Types
  class AiTaskOutcomeType < Types::BaseObject
    field :id, ID, null: false
    field :task_id, ID, null: false
    field :status, Types::AiTaskStatusEnum, null: false
    field :completed_at, GraphQL::Types::ISO8601DateTime, null: false
    field :title, String, null: false
    field :destination, String, null: false

    def task_id = object.ai_task_id
    def title = description[:title]
    def destination = description[:destination]

    private

    def description
      @description ||= AiTasks::DescribeTaskOutcomeService.call(outcome: object).value
    end
  end
end
