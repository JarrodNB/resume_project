/**
 * Description: Upload a resume and follow its parse live; development builds can load a project sample.
 * Index:
 *   - ResumeUploadPage: page component
 */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ResumeDropzone } from './ResumeDropzone'
import { useParseResume } from './useParseResume'

/** Uploads the chosen resume and moves to its task page, where parsing progress shows live. */
export function ResumeUploadPage() {
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
    <div className="mx-auto grid max-w-2xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Import your resume</h1>
        <p className="text-muted-foreground">
          We'll read your resume and turn it into a career library you can tailor from. You'll review
          everything before it's saved, and nothing is invented.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Upload a file</CardTitle>
          <CardDescription>Your existing resume, as a PDF or Word document.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ErrorAlert messages={errors} title="Upload failed" />
          {sampleError && <ErrorAlert messages={[sampleError]} title="Sample unavailable" />}
          <ResumeDropzone onFileSelected={handleFileSelected} busy={uploading || loadingSample} />
          {import.meta.env.DEV && <Button className="justify-self-start" disabled={uploading || loadingSample} onClick={() => void handleLoadSample()} variant="outline">
            {loadingSample ? 'Loading sample…' : 'Load project sample resume (development only)'}
          </Button>}
        </CardContent>
      </Card>
    </div>
  )
}
