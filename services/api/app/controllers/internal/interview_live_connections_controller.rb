# Private callbacks for the live interview agent (ai-live). The agent authenticates with the
# interview service secret; the live connection record establishes which session it may touch.
# Business rules live in the live connection services; this controller only maps HTTP.
module Internal
  class InterviewLiveConnectionsController < ActionController::API
    include ServiceCallbacks
    before_action :find_connection
    rescue_from ActiveRecord::RecordNotFound, with: -> { render json: { errors: [ "Record not found" ] }, status: :not_found }
    rescue_from ActionController::ParameterMissing, with: -> { render json: { errors: [ "Missing parameter" ] }, status: :unprocessable_entity }

    def claim
      respond Interviews::ClaimLiveConnectionService.call(connection: @connection, room_name: params.require(:room_name))
    end

    def prompt_asked
      respond Interviews::RecordLivePromptService.call(connection: @connection,
        question_position: params.require(:question_position), kind: params.require(:kind), text: params[:text], prompt_key: params[:prompt_key])
    end

    def answer_finished
      respond Interviews::RecordLiveAnswerService.call(connection: @connection,
        prompt_message_id: params.require(:prompt_message_id), transcript: params[:transcript])
    end

    def question_advanced
      respond Interviews::AdvanceLiveQuestionService.call(connection: @connection,
        question_position: params.require(:question_position))
    end

    private

    def service_busy_message
      "Interview service is busy; retry the same request"
    end

    def find_connection
      @connection = InterviewLiveConnection.find(params[:id])
    end

    def respond(result)
      render json: result.success? ? result.value : { errors: result.errors }, status: result.success? ? :ok : :conflict
    end
  end
end
