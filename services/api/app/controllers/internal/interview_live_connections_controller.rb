# Private callbacks for the live interview agent (ai-live). The agent authenticates with the
# interview service secret; the live connection record establishes which session it may touch.
# Business rules live in the live connection services; this controller only maps HTTP.
# A refusal is 409 with `errors`; when the connection or its session is over it also has
# `code: "connection_ended"`, which tells the agent to leave (other refusals are just stale reports).
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

    def feedback_given
      respond Interviews::RecordLiveFeedbackService.call(connection: @connection,
        question_position: params.require(:question_position), text: params[:text])
    end

    def question_retried
      respond Interviews::RetryLiveQuestionService.call(connection: @connection,
        question_position: params.require(:question_position), retry_number: params.require(:retry_number))
    end

    def heartbeat
      respond Interviews::RecordLiveHeartbeatService.call(connection: @connection, sequence: params.require(:sequence),
        billed_seconds_delta: params.require(:billed_seconds_delta), usage: params.to_unsafe_h["usage"])
    end

    def finish
      respond Interviews::FinishLiveService.call(connection: @connection, reason: params.require(:reason),
        final_sequence: params[:final_sequence])
    end

    private

    def service_busy_message
      "Interview service is busy; retry the same request"
    end

    def find_connection
      @connection = InterviewLiveConnection.find(params[:id])
    end

    def respond(result)
      return render json: result.value, status: :ok if result.success?

      render json: { errors: result.errors, code: result.code&.to_s }.compact, status: :conflict
    end
  end
end
