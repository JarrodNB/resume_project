# Machine-only capture callbacks authenticate the AI process; capture records establish ownership.
module Internal
  class InterviewTranscriptionsController < ActionController::API
    include ServiceCallbacks

    def update
      usage = params[:usage]
      usage = usage.to_unsafe_h if usage.respond_to?(:to_unsafe_h)
      result = Interviews::TranscriptionCaptureService.call(action: params[:action_name], token: params[:token],
        capture_id: params[:capture_id], transcript: params[:transcript], usage: usage)
      render json: result.success? ? result.value : { errors: result.errors }, status: result.success? ? :ok : :conflict
    end

    private

    def service_busy_message
      "Interview service is busy"
    end
  end
end
