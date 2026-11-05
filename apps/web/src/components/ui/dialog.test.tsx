/** Checks that closing a dialog puts keyboard focus back on whatever opened it. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'

it('returns focus to its own trigger button', async () => {
  const user = userEvent.setup()
  render(<Dialog><DialogTrigger>Open it</DialogTrigger><DialogContent><DialogTitle>Hi</DialogTitle></DialogContent></Dialog>)
  await user.click(screen.getByRole('button', { name: 'Open it' }))
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Open it' })).toHaveFocus()
})

it('returns focus to the menu button when opened from a dropdown menu item', async () => {
  const user = userEvent.setup()
  function Example() {
    const [open, setOpen] = useState(false)
    return <>
      <DropdownMenu>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem onSelect={() => setOpen(true)}>Edit</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Editing</DialogTitle></DialogContent></Dialog>
    </>
  }
  render(<Example />)
  await user.click(screen.getByRole('button', { name: 'More' }))
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'More' })).toHaveFocus()
})
