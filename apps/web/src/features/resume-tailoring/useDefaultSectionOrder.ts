/**
 * Description: Reads and saves the user's default resume section order. The library page shows
 * sections in this order and new resumes start from it; saved resumes keep their own order.
 * A save shows immediately and undoes itself if the server rejects it.
 * Index:
 *   - useDefaultSectionOrder: the order, whether it is still loading, saveOrder, and errors
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { graphql } from '@/graphql/generated'
import type { ResumeSectionTypeEnum } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { MOVABLE_SECTIONS, type MovableSectionType } from './sectionOrder'

export const DEFAULT_SECTION_ORDER_QUERY = graphql(`
  query DefaultSectionOrder {
    me {
      id
      resumeSectionOrder
    }
  }
`)

export const SAVE_DEFAULT_SECTION_ORDER_MUTATION = graphql(`
  mutation SaveDefaultSectionOrder($order: [ResumeSectionTypeEnum!]!) {
    updateProfile(input: { attributes: { resumeSectionOrder: $order } }) {
      user {
        id
        resumeSectionOrder
      }
      errors
    }
  }
`)

const toGraphqlOrder = (order: readonly MovableSectionType[]) => order.map((sectionType) => sectionType.toUpperCase() as ResumeSectionTypeEnum)

/** The saved order in the app's section names, or the standard order until it is known. */
function fromGraphqlOrder(order: readonly ResumeSectionTypeEnum[] | undefined): readonly MovableSectionType[] {
  if (!order) return MOVABLE_SECTIONS
  return order.map((sectionType) => sectionType.toLowerCase() as MovableSectionType)
}

/** Returns the user's default section order and a way to change it. */
export function useDefaultSectionOrder() {
  const { data, loading } = useQuery(DEFAULT_SECTION_ORDER_QUERY)
  const [save] = useMutation(SAVE_DEFAULT_SECTION_ORDER_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function saveOrder(order: readonly MovableSectionType[]) {
    setErrors([])
    setSaving(true)
    const graphqlOrder = toGraphqlOrder(order)
    try {
      const { data: saved } = await save({
        variables: { order: graphqlOrder },
        optimisticResponse: data?.me && { updateProfile: { user: { id: data.me.id, resumeSectionOrder: graphqlOrder }, errors: [] } },
      })
      const failure = saved?.updateProfile?.errors ?? ["Couldn't save the section order. Please try again."]
      setErrors(failure)
      return failure.length === 0
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't save the section order. Check your connection and try again.")])
      return false
    } finally {
      setSaving(false)
    }
  }

  return { order: fromGraphqlOrder(data?.me?.resumeSectionOrder), loading, saveOrder, saving, errors }
}
