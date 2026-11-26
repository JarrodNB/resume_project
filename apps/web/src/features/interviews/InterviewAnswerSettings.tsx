/** The setup step that picks how spoken answers are captured: when the mic opens, whether answers send
 * themselves when you stop talking (hands-free) and after how long a silence, and how speech becomes text.
 * Changing these never requests microphone access or starts capture. They are remembered per account.
 * The live room has its own controls because switching there can discard a recording in progress.
 */
import { SetupRow, Switch } from './InterviewSetupControls'
import type { TranscriptionMode } from './transcriptionCapture'
import { HANDS_FREE_NEEDS_LIVE_TRANSCRIPTION, SETUP_TRANSCRIPTION_OPTIONS } from './transcriptionHelp'
import { SILENCE_LENGTH_OPTIONS, type useInterviewMicSettings } from './useInterviewMicSettings'

const microphoneOptions = [{ value: 'automatic', label: 'Automatic' }, { value: 'tap', label: 'Tap to start' }]
const handsFreeOptions = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]
const silenceOptions = SILENCE_LENGTH_OPTIONS.map((option) => ({ value: String(option.seconds), label: `${option.name} ${option.seconds} sec` }))
const thinkingOptions = [{ value: '0', label: 'Off' }, { value: '3', label: '3 sec' }, { value: '5', label: '5 sec' }, { value: '10', label: '10 sec' }]

export function InterviewAnswerSettings({ microphone, canRecord, mode, changeMode }: { microphone: ReturnType<typeof useInterviewMicSettings>; canRecord: boolean; mode: TranscriptionMode; changeMode: (mode: TranscriptionMode) => void }) {
  const transcription = SETUP_TRANSCRIPTION_OPTIONS.find((option) => option.value === mode) ?? SETUP_TRANSCRIPTION_OPTIONS[0]
  return <div className="interview-answer-settings">
    {canRecord ? <>
      <SetupRow title="Microphone">
        <Switch name="microphone" options={microphoneOptions} value={microphone.automatic ? 'automatic' : 'tap'} change={(value) => microphone.update({ automatic: value === 'automatic' })} />
        <p className="interview-setup-help">{microphone.automatic ? 'Opens when each question finishes playing.' : 'Tap the mic for each answer.'}</p>
      </SetupRow>
      {microphone.automatic && <SetupRow title="Thinking time">
        <Switch name="thinking-time" columns={4} options={thinkingOptions} value={String(microphone.seconds)} change={(value) => microphone.update({ seconds: Number(value) })} />
        <p className="interview-setup-help">Pause before the mic opens. Tap the mic to start sooner.</p>
      </SetupRow>}
      <SetupRow title="Hands-free">
        <Switch name="hands-free" options={handsFreeOptions} value={microphone.handsFree ? 'on' : 'off'} disabled={mode === 'recorded'} change={(value) => microphone.update({ handsFree: value === 'on' })} />
        <p className="interview-setup-help">{mode === 'recorded' ? HANDS_FREE_NEEDS_LIVE_TRANSCRIPTION : 'When you stop talking, your answer sends after a short countdown. You can keep editing instead.'}</p>
      </SetupRow>
      <SetupRow title="Silence length">
        <Switch name="silence-length" options={silenceOptions} value={String(microphone.silenceSeconds)} disabled={mode === 'recorded' || !microphone.handsFree} change={(value) => microphone.update({ silenceSeconds: Number(value) })} />
        <p className="interview-setup-help">How long you stay quiet before a hands-free answer ends. Choose Patient if you pause to think.</p>
      </SetupRow>
    </> : <SetupRow group={false} title="Microphone"><p className="interview-answer-note">This browser can’t record. You can type every answer.</p></SetupRow>}
    <SetupRow title="Transcription">
      <Switch name="transcription" options={SETUP_TRANSCRIPTION_OPTIONS} value={mode} change={(value) => changeMode(value as TranscriptionMode)} />
      <p className="interview-setup-help">{transcription.description}</p>
    </SetupRow>
  </div>
}
