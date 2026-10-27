/** Fetch location choices only on request. Generations discard replies to edited text. */
import { useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_BOARD_LOCATIONS_QUERY } from './jobBoardOperations'
import type { LocationChoice } from './JobBoardLocationPicker'

export function useJobBoardLocations() {
  const client = useApolloClient()
  const generation = useRef(0)
  const [choices, setChoices] = useState<LocationChoice[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  function reset() {
    generation.current += 1
    setChoices([]); setErrors([]); setSearched(false); setLoading(false)
  }
  async function findLocations(query: string) {
    const current = ++generation.current
    setLoading(true); setErrors([]); setChoices([]); setSearched(false)
    try {
      const { data } = await client.query({ query: JOB_BOARD_LOCATIONS_QUERY, variables: { query }, fetchPolicy: 'no-cache' })
      if (current !== generation.current) return
      setErrors(data?.jobBoardLocations.errors ?? ['Could not load locations. Please try again.'])
      setChoices(data?.jobBoardLocations.locations ?? [])
      setSearched(true)
    } catch (error) {
      if (current !== generation.current) return
      setErrors([requestErrorMessage(error, 'Could not load locations. Please try again.')])
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }
  return { choices, loading, searched, errors, reset, findLocations }
}
