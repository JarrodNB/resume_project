# Backfill every existing session to the original offline execution configuration.
# Mode and exact approved presets are checked even when validation is bypassed.
class AddInterviewExecutionConfiguration < ActiveRecord::Migration[8.1]
  def change
    fake = { transcription_model: "fake-transcription-v1", interviewer_model: "fake-interviewer-v1", speech_model: "fake-speech-v1", voice: "espeak" }
    real = { transcription_model: "gpt-transcribe", interviewer_model: "gpt-6-luna", speech_model: "gpt-4o-mini-tts", voice: "marin" }
    add_column :interview_sessions, :execution_mode, :string, null: false, default: "fake"
    add_column :interview_sessions, :execution_config, :jsonb, null: false, default: fake
    add_check_constraint :interview_sessions,
      "(execution_mode = 'fake' AND execution_config = '#{fake.to_json}'::jsonb) OR (execution_mode = 'real' AND execution_config = '#{real.to_json}'::jsonb)",
      name: "interview_execution_configuration"
  end
end
