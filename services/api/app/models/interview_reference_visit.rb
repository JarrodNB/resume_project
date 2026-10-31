# Remembers that a browser visit has already requested or joined a prompt's search.
class InterviewReferenceVisit < ApplicationRecord
  belongs_to :career_references, class_name: 'InterviewCareerReferences'
end
