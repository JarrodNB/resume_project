/** Remembers whether this browser shows Home as a board or a list. Falls back to the board
 * when storage is unavailable; the choice is a convenience, not saved data. */
import { productStorageKey } from '@/lib/productName'

export type HomeView = 'board' | 'list'
const HOME_VIEW_STORAGE_KEY = productStorageKey('homeView')

export function readHomeView(): HomeView {
  try {
    return localStorage.getItem(HOME_VIEW_STORAGE_KEY) === 'list' ? 'list' : 'board'
  } catch {
    return 'board'
  }
}

export function rememberHomeView(view: HomeView) {
  try {
    localStorage.setItem(HOME_VIEW_STORAGE_KEY, view)
  } catch {
    // The toggle still works for this visit.
  }
}
