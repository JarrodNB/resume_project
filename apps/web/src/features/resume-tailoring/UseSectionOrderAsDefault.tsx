/** Copies one resume's section order to the user's default for new resumes. Other saved resumes keep theirs. */
import { Button } from '@/components/ui/button'
import { ErrorAlert } from '@/components/ErrorAlert'
import { defaultOrderFromResume, type TailorSectionType } from './sectionOrder'
import { useDefaultSectionOrder } from './useDefaultSectionOrder'

export function UseSectionOrderAsDefault({ resumeOrder, disabled = false }: { resumeOrder: TailorSectionType[]; disabled?: boolean }) {
  const { order, saveOrder, saving, errors } = useDefaultSectionOrder()
  const next = defaultOrderFromResume(resumeOrder, order)
  const alreadyDefault = next.every((sectionType, index) => sectionType === order[index])

  return (
    <div className="grid justify-items-start gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || saving || alreadyDefault} onClick={() => void saveOrder(next)}>
        {alreadyDefault ? 'This order is your default' : 'Use this order as my default'}
      </Button>
      <ErrorAlert messages={errors} title="Couldn't save your default order" />
    </div>
  )
}
