# Returns a fresh owner-scoped snapshot on connection and each durable update.
module Subscriptions
  class InterviewSessionUpdated < BaseSubscription
    argument :id, ID, required: true
    type Types::InterviewSessionType, null: false

    def subscribe(id:)
      Interviews::DemoAccess.find!(current_user, id)
    end

    def update(id:)
      subscribe(id: id)
    end
  end
end
