# Machine-only capture callbacks authenticate the AI process; capture records establish ownership.
module Internal
  class InterviewTranscriptionsController < ActionController::API
    before_action :authenticate_service
    around_action :bound_database_waits

    def update
      usage = params[:usage]
      usage = usage.to_unsafe_h if usage.respond_to?(:to_unsafe_h)
      result = Interviews::TranscriptionCaptureService.call(action: params[:action_name], token: params[:token],
        capture_id: params[:capture_id], transcript: params[:transcript], usage: usage)
      render json: result.success? ? result.value : { errors: result.errors }, status: result.success? ? :ok : :conflict
    end

    private

    def bound_database_waits
      ApplicationRecord.connection_pool.with_connection do |connection|
        lock_timeout = connection.select_value("SHOW lock_timeout")
        statement_timeout = connection.select_value("SHOW statement_timeout")
        begin
          connection.execute("SET lock_timeout = '2s'")
          connection.execute("SET statement_timeout = '5s'")
          yield
        ensure
          connection.execute("SET lock_timeout = #{connection.quote(lock_timeout)}")
          connection.execute("SET statement_timeout = #{connection.quote(statement_timeout)}")
        end
      end
    rescue ActiveRecord::LockWaitTimeout, ActiveRecord::QueryCanceled
      render json: { errors: [ "Interview service is busy" ] }, status: :service_unavailable
    end

    def authenticate_service
      expected = ENV["INTERVIEW_SERVICE_SECRET"]
      authorization = request.headers["Authorization"].to_s
      supplied = authorization.delete_prefix("Bearer ")
      unless authorization.start_with?("Bearer ") && expected.present? && supplied.present? && ActiveSupport::SecurityUtils.secure_compare(supplied, expected)
        render json: { errors: [ "Unauthorized" ] }, status: :unauthorized
      end
      response.set_header("Cache-Control", "no-store")
    end
  end
end
