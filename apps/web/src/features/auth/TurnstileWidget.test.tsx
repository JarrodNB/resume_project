/** The sign-up bot check reports tokens, expiry and failures, and cleans up after itself. */
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TurnstileWidget } from './TurnstileWidget'

type WidgetOptions = { callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }

// The module keeps one script promise, so every test shares this fake and resets its calls.
const turnstile = vi.hoisted(() => ({ render: vi.fn(() => 'widget-1'), remove: vi.fn() }))

function renderLoaded() {
  window.turnstile = turnstile as never
  const appended = vi.spyOn(document.head, 'appendChild').mockImplementationOnce((node) => {
    (node as HTMLScriptElement).onload?.(new Event('load'))
    return node
  })
  const onTokenChange = vi.fn()
  const view = render(<TurnstileWidget onTokenChange={onTokenChange} />)
  return { ...view, onTokenChange, appended }
}

async function widgetOptions(): Promise<WidgetOptions> {
  await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
  return (turnstile.render.mock.calls as unknown as [HTMLElement, WidgetOptions][])[0][1]
}

afterEach(() => { vi.restoreAllMocks(); turnstile.render.mockClear(); turnstile.remove.mockClear() })

it('reports a token, then clears it on expiry and failure', async () => {
  const { onTokenChange } = renderLoaded()
  const options = await widgetOptions()
  expect(screen.getByText(/security check/)).toBeInTheDocument()

  act(() => options.callback('token-1'))
  expect(onTokenChange).toHaveBeenLastCalledWith('token-1')
  expect(screen.queryByText(/security check/)).not.toBeInTheDocument()

  act(() => options['expired-callback']())
  expect(onTokenChange).toHaveBeenLastCalledWith(null)

  act(() => options['error-callback']())
  expect(screen.getByRole('alert')).toHaveTextContent("didn't finish")
})

it('removes the widget when unmounted', async () => {
  const { unmount } = renderLoaded()
  await widgetOptions()
  await act(async () => { await Promise.resolve() })
  unmount()
  expect(turnstile.remove).toHaveBeenCalledWith('widget-1')
})
