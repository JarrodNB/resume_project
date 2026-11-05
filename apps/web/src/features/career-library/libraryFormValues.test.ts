/** Tests for the form helpers that check required fields and fix up pasted web addresses. */
import { expect, it } from 'vitest'
import { normalizeWebAddress, requiredFieldErrors } from './libraryFormValues'

it('adds https:// to a bare address and keeps a full one', () => {
  expect(normalizeWebAddress('example.com/me')).toEqual({ value: 'https://example.com/me' })
  expect(normalizeWebAddress(' http://example.com ')).toEqual({ value: 'http://example.com' })
  expect(normalizeWebAddress('  ')).toEqual({ value: null })
})

it('explains text that is not a web address', () => {
  expect(normalizeWebAddress('not a link').error).toMatch(/web address/)
  expect(normalizeWebAddress('localdomain').error).toMatch(/web address/)
})

it('reports each blank required field', () => {
  expect(requiredFieldErrors({ name: { label: 'Name', value: ' ' }, role: { label: 'Role', value: 'x' } })).toEqual({ name: 'Name is required.' })
})
