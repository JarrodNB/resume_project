/**
 * Description: The certification section of the career library: the dated list, add, and edit.
 * Index:
 *   - CertificationSection: credentials with merge/delete and the certification form
 */
import { useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { formatCertificationDates } from '@/lib/formatCertificationDates'
import { CertificationFormDialog } from './CertificationFormDialog'
import { LibraryEntry } from './LibraryEntry'
import { LibraryEntryActions } from './LibraryEntryActions'
import { certificationLabel } from './libraryEntryLabels'
import { LibrarySection } from './LibrarySection'

type Certification = CareerLibraryQuery['certifications'][number]

/** Lists certification entries and opens the form to add one or edit one. */
export function CertificationSection({ certifications }: { certifications: Certification[] }) {
  const [editing, setEditing] = useState<Certification | 'new' | null>(null)
  const candidates = certifications.map((certification) => ({ id: certification.id, label: certificationLabel(certification) }))

  return (
    <>
      <LibrarySection
        sectionId="library.certifications"
        tone="certifications"
        title="Certifications"
        count={certifications.length}
        emptyText="No certifications yet."
        addLabel="Add certification"
        onAdd={() => setEditing('new')}
      >
        {certifications.map((certification, index) => (
          <LibraryEntry
            key={certification.id}
            tone="certifications"
            heading={certification.name}
            subheading={[certification.issuer, certification.credentialId, certification.credentialUrl].filter(Boolean).join(', ')}
            dates={formatCertificationDates(certification.issuedDate, certification.expiryDate)}
            description={certification.description}
            actions={
              <LibraryEntryActions
                kind="certification"
                entryId={certification.id}
                entryLabel={candidates[index].label}
                mergeCandidates={candidates.filter((candidate) => candidate.id !== certification.id)}
                onEdit={() => setEditing(certification)}
              />
            }
          />
        ))}
      </LibrarySection>
      <CertificationFormDialog open={editing !== null} certification={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
