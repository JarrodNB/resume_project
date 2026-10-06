/**
 * Description: Button that asks, then empties the career library.
 * Index:
 *   - ClearLibraryButton: opens the confirmation and runs the clear
 */
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClearLibraryDialog } from './ClearLibraryDialog'
import { useClearCareerLibrary } from './useClearCareerLibrary'

/** Shows Delete all and confirms before emptying the library. */
export function ClearLibraryButton() {
  const { clearLibrary, busy, errors, clearErrors } = useClearCareerLibrary()
  const [open, setOpen] = useState(false)

  /** Closes the dialog when the library was emptied. */
  async function confirm() {
    if (await clearLibrary()) setOpen(false)
  }

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => {
          clearErrors()
          setOpen(true)
        }}
      >
        <Trash2 /> Delete all
      </Button>
      <ClearLibraryDialog open={open} onOpenChange={setOpen} onConfirm={confirm} busy={busy} errors={errors} />
    </>
  )
}
