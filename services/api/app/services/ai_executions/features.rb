# Resolve a fixed feature adapter; payloads cannot choose arbitrary Ruby classes.
#
# Streaming needs two halves that must both exist: the feature's AI adapter sets
# `stream_output` (the AI service only emits output for such features), and the feature
# is listed in STREAM_AUTHORITIES below (Rails only authorizes observers for those).
# Interviews are in neither today, so no feature streams. See docs/architecture/ai-streaming.md.
module AiExecutions
  module Features
    # Feature name => class name of its stream authority. Names are strings so the
    # class is only loaded when used. Adding a streaming feature is one line here.
    STREAM_AUTHORITIES = {
      "interviews" => "Interviews::StreamAuthority"
    }.freeze

    def self.stream_authority(feature)
      name = STREAM_AUTHORITIES.fetch(feature) { raise ArgumentError, "Unknown execution feature" }

      name.constantize
    end

    def self.operation(feature, operation_id)
      raise ArgumentError, "Unknown execution feature" unless feature == "interviews"

      InterviewSessionOperation.find_by(id: operation_id)
    end

    def self.state(feature, operation_id, **fence)
      operation = operation(feature, operation_id)
      return { delivered: true } unless operation

      Interviews::DeliveryStateService.call(operation: operation, **fence).value
    end

    def self.recover(feature, operation_id, **identity)
      operation = operation(feature, operation_id)
      Interviews::RecoverOperationService.call(operation: operation, **identity) if operation
    end

    def self.stop(feature, operation_id, **fence)
      operation = operation(feature, operation_id)
      Interviews::StopDeliveryService.call(operation: operation, **fence) if operation
    end
  end
end
