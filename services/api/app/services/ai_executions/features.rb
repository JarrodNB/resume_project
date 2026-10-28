# Resolve a fixed feature adapter; payloads cannot choose arbitrary Ruby classes.
#
# Streaming needs two halves that must both exist: the feature's AI adapter sets
# `stream_output` (the AI service only emits output for such features), and the feature
# is listed in STREAM_AUTHORITIES below (Rails only authorizes observers for those).
# Interviews retain final-only execution; chat opts into streaming. See docs/architecture/ai-streaming.md.
module AiExecutions
  module Features
    # Feature name => class name of its stream authority. Names are strings so the
    # class is only loaded when used. Adding a streaming feature is one line here.
    STREAM_AUTHORITIES = {
      "interviews" => "Interviews::StreamAuthority",
      "chat" => "Chat::StreamAuthority"
    }.freeze

    def self.stream_authority(feature)
      name = STREAM_AUTHORITIES.fetch(feature) { raise ArgumentError, "Unknown execution feature" }

      name.constantize
    end

    def self.domain(feature)
      { "interviews" => Interviews, "chat" => Chat }.fetch(feature) { raise ArgumentError, "Unknown execution feature" }
    end

    def self.operation(feature, operation_id)
      model = { "interviews" => InterviewSessionOperation, "chat" => ChatOperation }.fetch(feature) { raise ArgumentError, "Unknown execution feature" }
      model.find_by(id: operation_id)
    end

    def self.state(feature, operation_id, **fence)
      operation = operation(feature, operation_id)
      return { delivered: true } unless operation

      domain(feature)::DeliveryStateService.call(operation: operation, **fence).value
    end

    def self.recover(feature, operation_id, **identity)
      operation = operation(feature, operation_id)
      domain(feature)::RecoverOperationService.call(operation: operation, **identity) if operation
    end

    def self.stop(feature, operation_id, **fence)
      operation = operation(feature, operation_id)
      domain(feature)::StopDeliveryService.call(operation: operation, **fence) if operation
    end
  end
end
