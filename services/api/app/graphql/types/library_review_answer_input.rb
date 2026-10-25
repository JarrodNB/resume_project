# One optional answer identified by its zero-based position in a saved review question set.
module Types
  class LibraryReviewAnswerInput < Types::BaseInputObject
    argument :question_index, Integer, required: true
    argument :answer, String, required: true
  end
end
