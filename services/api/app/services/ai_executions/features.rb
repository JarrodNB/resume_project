# Resolve a fixed feature adapter; payloads cannot choose arbitrary Ruby classes.
#
# Streaming needs two halves that must both exist: the feature's AI adapter sets
# `stream_output` (the AI service only emits output for such features), and the feature
# has a stream_authority in REGISTRY below (Rails only authorizes observers for those).
# Interviews retain final-only execution; chat opts into streaming. See docs/architecture/ai-streaming.md.
module AiExecutions
  module Features
    # One fixed registration owns a feature's lifecycle and optional observer authority.
    # Class names stay lazy so loading the registry does not load every feature.
    REGISTRY = {
      "interviews" => { domain: "Interviews", operation_model: "InterviewSessionOperation",
        stream_authority: "Interviews::StreamAuthority" }.freeze,
      "chat" => { domain: "Chat", operation_model: "ChatOperation",
        stream_authority: "Chat::StreamAuthority" }.freeze
    }.freeze

    def self.stream_authority(feature)
      name = registration(feature)[:stream_authority]
      raise ArgumentError, "Unknown execution feature" unless name

      name.constantize
    end

    def self.domain(feature)
      registration(feature).fetch(:domain).constantize
    end

    def self.operation(feature, operation_id)
      registration(feature).fetch(:operation_model).constantize.find_by(id: operation_id)
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

    def self.registration(feature)
      REGISTRY.fetch(feature) { raise ArgumentError, "Unknown execution feature" }
    end
    private_class_method :registration
  end
end
