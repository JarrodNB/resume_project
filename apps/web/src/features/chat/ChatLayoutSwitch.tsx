/** The "Design option" switch shown above the chat while the redesign options are under review. */
import { CHAT_LAYOUTS, type ChatLayout } from './chatLayouts'

export function ChatLayoutSwitch({ layout, onChoose }: { layout: ChatLayout; onChoose: (layout: ChatLayout) => void }) {
  const current = CHAT_LAYOUTS.find((item) => item.id === layout)
  return <div className="chat-layout-switch">
    <span id="chat-layout-label" className="chat-layout-switch-label">Design option</span>
    <div className="view-switch" role="group" aria-labelledby="chat-layout-label">
      {CHAT_LAYOUTS.map((item) => <button key={item.id} type="button" aria-pressed={item.id === layout} onClick={() => onChoose(item.id)}>{item.label}</button>)}
    </div>
    <p>{current?.summary}</p>
  </div>
}
