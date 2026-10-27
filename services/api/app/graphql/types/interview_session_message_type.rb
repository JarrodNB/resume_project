# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewSessionMessageType < Types::BaseObject
    field :avoided, Boolean, null: false
    field :id, ID, null: false
    field :question_id, ID, null: false
    field :kind, String, null: false
    field :position, Integer, null: false
    field :content, String, null: false
    field :acknowledgement, String, null: true
    field :career_references, Types::InterviewCareerReferencesType, null: true
    field :clarification, Types::InterviewClarificationType, null: true
    field :spoken_content, String, null: false

    def avoided
      %w[opening follow_up].include?(object.kind) && ::InterviewPreferences::AvoidedQuestions.saved?(object.interview_session.user, object.content)
    end

    def career_references
      object.career_references if ::Interviews::ClarificationPrompt.current?(object.interview_session, object)
    end

    def clarification
      object.clarification if ::Interviews::ClarificationPrompt.current?(object.interview_session, object)
    end

    def spoken_content
      Interviews::MessageText.spoken_content(object)
    end
  end
end
