# Machine-only observer checks keep browser/session authority in Rails.
module Internal
  class ExecutionStreamsController < ActionController::API
    include ServiceCallbacks

    def update
      result = AiExecutions::StreamGrantService.call(action: params[:action_name],
        token: params[:token], grant_id: params[:grant_id])
      render json: result.success? ? result.value : { errors: result.errors },
        status: result.success? ? :ok : :conflict
    end

    private

    def service_secret
      ENV["AI_EXECUTION_SERVICE_SECRET"].presence || ENV["INTERVIEW_SERVICE_SECRET"]
    end

    def service_busy_message
      "Stream authorization unavailable"
    end
  end
end
