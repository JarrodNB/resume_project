/** Read saved import suggestions whenever Find jobs opens, keeping defaults on missing data. */
import { useQuery } from '@apollo/client/react'
import { JOB_BOARD_SEARCH_IDEAS_QUERY } from './jobBoardOperations'

const defaultIdeas = ['Software engineer', 'Product designer', 'Data analyst']

export function useJobBoardSearchIdeas() {
  const { data } = useQuery(JOB_BOARD_SEARCH_IDEAS_QUERY, { fetchPolicy: 'network-only' })
  const suggestions = data?.me?.jobTitleSuggestions
  return suggestions?.length ? suggestions : defaultIdeas
}
