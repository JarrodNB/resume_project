/** Upload a resume from the career library, then open its live parse and review step. */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { ResumeDropzone } from './ResumeDropzone'
import { useParseResume } from './useParseResume'

/** Uploads the chosen resume and moves to its task page, where parsing progress shows live. */
export function ResumeUpload() {
  const navigate = useNavigate()
  const { parseResume, uploading, errors } = useParseResume()
  const [loadingSample, setLoadingSample] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)

  async function handleFileSelected(file: File) {
    const aiTaskId = await parseResume(file)
    if (aiTaskId) navigate(`/library/import/${aiTaskId}`)
  }

  async function handleLoadSample() {
    setLoadingSample(true)
    setSampleError(null)
    try {
      const response = await fetch('/__dev-sample-resume')
      if (!response.ok) throw new Error('Sample file request failed')
      const sample = new File([await response.blob()], 'uci_business.pdf', { type: 'application/pdf' })
      await handleFileSelected(sample)
    } catch {
      setSampleError('Could not load the project sample. Refresh and try again.')
    } finally {
      setLoadingSample(false)
    }
  }

  return (
    <div className="grid w-full gap-4">
      <ErrorAlert messages={errors} title="Upload failed" />
      {sampleError && <ErrorAlert messages={[sampleError]} title="Sample unavailable" />}
      <ResumeDropzone onFileSelected={handleFileSelected} busy={uploading || loadingSample} />
      {import.meta.env.DEV && <Button className="h-auto min-h-9 max-w-full justify-self-start whitespace-normal text-left" disabled={uploading || loadingSample} onClick={() => void handleLoadSample()} variant="outline">
        {loadingSample ? 'Loading sample…' : 'Load project sample resume (development only)'}
      </Button>}
    </div>
  )
}
