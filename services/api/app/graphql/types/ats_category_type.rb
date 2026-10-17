# A rubric category retains evidence and individual deductions for transparent feedback.
module Types
  class AtsCategoryType < BaseObject
    field :status, String, null: false
    field :score, Integer
    field :reason, String
    field :assessments, GraphQL::Types::JSON, null: false
    field :deductions, GraphQL::Types::JSON, null: false
    def assessments
      object["assessments"] || []
    end
    def deductions
      object["deductions"] || []
    end
  end
end
