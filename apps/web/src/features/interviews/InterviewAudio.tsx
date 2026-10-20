/** Request a fresh owner-bound URL for the existing saved artifact. Playback never regenerates speech. */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { Button } from '@/components/ui/button'
import { INTERVIEW_PLAYBACK } from './interviewOperations'

export function InterviewAudio({ interviewId, messageId }: { interviewId: string; messageId: string }) {
  const [request, { loading }] = useMutation(INTERVIEW_PLAYBACK)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function load() {
    setError(null)
    try {
      const payload = (await request({ variables: { input: { interviewId, messageId } } })).data?.interviewPlayback
      if (!payload?.playback || payload.errors.length) throw new Error(payload?.errors.join(' ') || 'This audio is unavailable or expired.')
      setUrl(payload.playback.playbackUrl)
    } catch (cause) { setUrl(null); setError(cause instanceof Error ? cause.message : 'Could not load saved audio.') }
  }
  return <div className="grid gap-2">
    <Button variant="outline" className="justify-self-start" disabled={loading} onClick={() => void load()}>{loading ? 'Loading audio…' : url ? 'Refresh playback link' : 'Load saved audio'}</Button>
    {url && <audio className="max-w-full" controls preload="none" src={url} aria-label="Saved interviewer speech" onError={() => { setUrl(null); setError('The playback link may have expired. Load saved audio again for a fresh link. Audio itself expires one hour after completion.') }} />}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
