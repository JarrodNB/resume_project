# The scheduled recovery for live rooms whose agent went quiet: a connection whose last heartbeat
# is older than 150 seconds is ended as disconnected, and one that was joined but never claimed
# within the token's 10 minutes is ended as failed. Both finish the interview by the usual rule.
require "rails_helper"

RSpec.describe Interviews::RecoverLiveConnectionsJob do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }
  let(:interview) { ready_live_interview(user) }
  let(:connection) do
    with_livekit_env { Interviews::JoinLiveService.call(interview: interview) }
    interview.reload.live_connections.sole
  end

  def claim_and_answer
    Interviews::ClaimLiveConnectionService.call(connection: connection, room_name: connection.room_name)
    prompt = Interviews::RecordLivePromptService.call(connection: connection, question_position: 0, kind: "opening", text: "Hi.").value
    Interviews::RecordLiveAnswerService.call(connection: connection, prompt_message_id: prompt[:message_id], transcript: "I rebuilt it.")
  end

  it "ends a connection whose heartbeat stopped as disconnected and completes the answered interview, once" do
    claim_and_answer
    travel 149.seconds do
      described_class.perform_now
      expect(connection.reload.status).to eq("connected")
    end
    travel 151.seconds do
      described_class.perform_now
      expect(connection.reload).to have_attributes(status: "ended", end_reason: "disconnected")
      expect(interview.reload.status).to eq("completed")
      expect(connection.ai_task.ai_usage_attempts.sole).to have_attributes(finalized: true, incomplete: true)
      revision = interview.revision
      described_class.perform_now
      expect(interview.reload.revision).to eq(revision)
    end
  end

  it "abandons an interview without answers whose agent went quiet" do
    Interviews::ClaimLiveConnectionService.call(connection: connection, room_name: connection.room_name)
    travel 3.minutes do
      described_class.perform_now
      expect(connection.reload.end_reason).to eq("disconnected")
      expect(interview.reload.status).to eq("abandoned")
    end
  end

  it "keeps a connection whose heartbeat arrived in time" do
    claim_and_answer
    travel 2.minutes do
      Interviews::RecordLiveHeartbeatService.call(connection: connection, sequence: 1, billed_seconds_delta: 30, usage: [])
    end
    travel 4.minutes do
      described_class.perform_now
      expect(connection.reload.status).to eq("connected")
    end
  end

  it "ends a joined room the agent never claimed as failed once the join token has expired" do
    connection
    travel 9.minutes do
      described_class.perform_now
      expect(connection.reload.status).to eq("authorized")
    end
    travel 11.minutes do
      described_class.perform_now
      expect(connection.reload).to have_attributes(status: "ended", end_reason: "failed")
      expect(interview.reload.status).to eq("abandoned")
    end
  end

  it "counts the claim wait from the latest join, so a rejoin's fresh token gets its full 10 minutes" do
    connection
    travel 9.minutes do
      with_livekit_env { Interviews::JoinLiveService.call(interview: interview) }
      expect(interview.reload.live_connections.sole).to eq(connection)
    end
    travel 10.minutes + 30.seconds do
      described_class.perform_now
      expect(connection.reload.status).to eq("authorized")
      claimed = Interviews::ClaimLiveConnectionService.call(connection: connection, room_name: connection.room_name)
      expect(claimed).to be_success
      expect(connection.reload.status).to eq("connected")
    end
  end

  it "ends a rejoined room the agent never claimed once the rejoin's token has expired" do
    connection
    travel(9.minutes) { with_livekit_env { Interviews::JoinLiveService.call(interview: interview) } }
    travel 19.minutes + 1.second do
      described_class.perform_now
      expect(connection.reload).to have_attributes(status: "ended", end_reason: "failed")
    end
  end

  it "does not finish a connection that a late heartbeat revived after it was picked" do
    claim_and_answer
    travel 3.minutes do
      stale = InterviewLiveConnection.find(connection.id)
      connection.update_columns(last_heartbeat_at: Time.current)
      result = Interviews::FinishLiveService.call(connection: stale, reason: "disconnected",
        stale_before: Time.current - Interviews::RecoverLiveConnectionsService::HEARTBEAT_TIMEOUT)
      expect(result).not_to be_success
      expect(connection.reload.status).to eq("connected")
    end
  end

  it "closes a quiet connection of an interview that already finished without changing the interview" do
    claim_and_answer
    interview.update!(status: "abandoned")
    travel 3.minutes do
      described_class.perform_now
      expect(connection.reload).to have_attributes(status: "ended", end_reason: "disconnected")
      expect(connection.ai_task.reload.status).to eq("completed")
      expect(interview.reload.status).to eq("abandoned")
    end
  end

  it "ends a connection still open 5 minutes past the 45-minute cap as time_limit, even while it heartbeats" do
    claim_and_answer
    cap = Interviews::LiveAllowance::CONNECTION_WALL_CLOCK
    sequence = 0
    heartbeat_at = ->(offset) do
      travel(offset) do
        Interviews::RecordLiveHeartbeatService.call(connection: connection, sequence: sequence += 1, billed_seconds_delta: 0, usage: [])
        described_class.perform_now
      end
    end
    heartbeat_at.call(cap + 4.minutes)
    expect(connection.reload.status).to eq("connected")
    heartbeat_at.call(cap + 5.minutes + 1.second)
    expect(connection.reload).to have_attributes(status: "ended", end_reason: "time_limit")
    expect(interview.reload.status).to eq("completed")
  end

  it "is scheduled about every minute in recurring.yml for development and production" do
    config = YAML.safe_load_file(Rails.root.join("config/recurring.yml"), aliases: true)
    %w[development production].each do |env|
      entry = config.fetch(env).values.find { |task| task["class"] == described_class.name }
      expect(entry["schedule"]).to eq("every minute")
    end
  end
end
