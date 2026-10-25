# Covers completions while GraphQL and ActionCable are still registering a private feed.
# Delayed pubsub confirmations exercise the real channel stream-registration seam.
require "rails_helper"

RSpec.describe GraphqlChannel, type: :channel do
  self.use_transactional_tests = false

  let!(:user) { create(:user) }
  let(:query) { "subscription { feed: aiTaskFinished { watermark: cursor outcome { id } } }" }

  after do
    subscription&.unsubscribed
    user.destroy!
  end

  [ false, true ].each do |immediate_confirmation|
    it "captures the watermark after #{immediate_confirmation ? 'immediate' : 'delayed'} transport registration and preserves aliases" do
      registrations = []
      confirmations = []
      pool = Object.new
      def pool.async_invoke(receiver, method, *arguments, **_options)
        receiver.send(method, *arguments)
      end
      stub_connection current_user: user, session_valid?: true, check_session: nil
      connection.define_singleton_method(:worker_pool) { pool }
      @subscription = described_class.new(connection, "outcome-registration", {})
      subscription.subscribe_to_channel
      allow(connection.server.event_loop).to receive(:post) do |&block|
        immediate_confirmation ? block.call : registrations << block
      end
      allow(connection.server.pubsub).to receive(:subscribe) do |_stream, _handler, ready|
        immediate_confirmation ? ready.call : confirmations << ready
      end
      allow(ApiSchema.subscriptions).to receive(:write_subscription).and_wrap_original do |original, graph_query, events|
        task = create(:ai_task, user: user)
        AiTasks::UpdateTaskService.call(task: task, attributes: { status: "completed", completed_at: Time.current })
        original.call(graph_query, events)
      end
      subscription.execute("query" => query)
      unless immediate_confirmation
        expect(transmissions).to be_empty
        registrations.each(&:call)
        expect(transmissions).to be_empty
        # A second completion after stream_from returns must also enter the baseline.
        task = create(:ai_task, user: user)
        AiTasks::UpdateTaskService.call(task: task, attributes: { status: "failed", completed_at: Time.current })
        confirmations.first.call
        expect(transmissions).to be_empty
        confirmations.drop(1).each(&:call)
      end
      expect(transmissions.sole["result"]["data"]).to eq("feed" => {
        "watermark" => user.ai_task_outcomes.maximum(:sequence).to_s, "outcome" => nil })
      expect(transmissions.sole["more"]).to be(true)
    end
  end
end
