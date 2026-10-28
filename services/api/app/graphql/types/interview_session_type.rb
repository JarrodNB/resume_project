# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewSessionType < Types::BaseObject
    field :feedback, Types::InterviewSessionFeedbackType, null: true
    field :id, ID, null: false
    field :status, String, null: false
    field :execution_mode, String, null: false
    field :speech_playback_mode, String, null: false
    field :interview_type, String, null: false
    field :prepared_role, GraphQL::Types::JSON, null: false
    field :job_context, Types::InterviewJobContextType, null: true
    field :setup, Types::InterviewSetupType, null: false
    field :revision, Integer, null: false
    field :answer_cap, Integer, null: false
    field :current_question_position, Integer, null: false
    field :expires_at, GraphQL::Types::ISO8601DateTime, null: false
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
    field :questions, [ Types::InterviewSessionQuestionType ], null: false
    field :messages, [ Types::InterviewSessionMessageType ], null: false
    field :operations, [ Types::InterviewSessionOperationType ], null: false

    def feedback
      object.feedback if object.completed? && object.expires_at > Time.current && !object.content_purged_at
    end

    def speech_playback_mode
      Interviews::SpeechPlayback.mode(object)
    end

    def job_context
      context = object.frozen_context["job"]
      context&.merge("id" => object.job_id)
    end

    def setup
      Interviews::SetupConfiguration.for(object)
    end

    def operations
      object.operations.order(:created_at, :id)
    end
  end
end
