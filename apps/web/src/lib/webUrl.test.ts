/**
 * Description: Tests for the web-address safety checks.
 */
import { expect, it } from 'vitest'
import { hasUrlScheme, isWebUrl } from './webUrl'

it('accepts only http and https URLs', () => {
  expect(isWebUrl('https://example.com/me')).toBe(true)
  expect(isWebUrl(' http://example.com ')).toBe(true)
  expect(isWebUrl('javascript:alert(1)')).toBe(false)
  expect(isWebUrl('data:text/html,<b>x</b>')).toBe(false)
  expect(isWebUrl('example.com')).toBe(false)
})

it('tells a URL scheme from a host with a port', () => {
  expect(hasUrlScheme('javascript:alert(1)')).toBe(true)
  expect(hasUrlScheme('mailto:me@example.com')).toBe(true)
  expect(hasUrlScheme('example.com:8080/path')).toBe(false)
  expect(hasUrlScheme('example.com')).toBe(false)
})
