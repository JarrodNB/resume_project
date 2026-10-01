/**
 * Description: First step of importing a resume: upload the file, then follow the parse live.
 * Index:
 *   - ResumeUploadPage: page component
 */
import { useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ResumeDropzone } from './ResumeDropzone'
import { useParseResume } from './useParseResume'

/** Uploads the chosen resume and moves to its task page, where parsing progress shows live. */
export function ResumeUploadPage() {
  const navigate = useNavigate()
  const { parseResume, uploading, errors } = useParseResume()

  async function handleFileSelected(file: File) {
    const aiTaskId = await parseResume(file)
    if (aiTaskId) navigate(`/import/${aiTaskId}`)
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
          <ResumeDropzone onFileSelected={handleFileSelected} busy={uploading} />
        </CardContent>
      </Card>
    </div>
  )
}
