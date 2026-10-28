/**
 * The three chat design options being reviewed, and the hook that reads the chosen one.
 *
 * The choice lives in the URL (`?layout=line`) so a link shows the same option. This file and
 * ChatLayoutSwitch go away once one option is picked; the default is the first option.
 */
import { useSearchParams } from 'react-router'

export const CHAT_LAYOUTS = [
  { id: 'timetable', label: 'Timetable', summary: 'Chats listed like a departures board, replies in a table of rows.' },
  { id: 'line', label: 'The Line', summary: 'One conversation drawn as a line of stops, with a chat switcher on top.' },
  { id: 'desk', label: 'Desk', summary: 'Chats, conversation and a plain notes panel side by side.' },
] as const

export type ChatLayout = (typeof CHAT_LAYOUTS)[number]['id']

/** Reads the chosen option and the query string that keeps it when links move between chats. */
export function useChatLayout() {
  const [params, setParams] = useSearchParams()
  const chosen = CHAT_LAYOUTS.find((layout) => layout.id === params.get('layout'))
  const layout: ChatLayout = chosen?.id ?? 'timetable'
  const search = chosen ? `?layout=${chosen.id}` : ''
  function choose(next: ChatLayout) {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('layout', next)
      return updated
    }, { replace: true })
  }
  return { layout, search, choose }
}
