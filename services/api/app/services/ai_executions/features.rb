# Resolve a fixed feature adapter; payloads cannot choose arbitrary Ruby classes.
module AiExecutions
  module Features
    def self.stream_authority(feature)
      raise ArgumentError, "Unknown execution feature" unless feature == "interviews"

      Interviews::StreamAuthority
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
