# Description: Deletes an authorized practice set while serializing against new question tasks.
# Index:
#   - call: removes questions and nullifies task subjects, retaining AI usage records
module InterviewPrep
  class DeleteQuestionSetService < ApplicationService
    # Receives a set already scoped to its owner.
    def initialize(question_set:)
      @question_set = question_set
    end

    # Deletes under the same owner lock used when saving and queueing operations.
    def call
      @question_set.user.with_lock do
        @question_set.reload
        @question_set.destroy ? success(@question_set) : failure(@question_set.errors)
      end
    end
  end
end
