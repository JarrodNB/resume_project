/** Bookmarkable searches reject malformed provider inputs. */
import { expect, it } from 'vitest'
import { parseSearchUrl, serializeSearchUrl } from './searchUrl'
it('round-trips all supported filters and resolved labels', () => {
  const search = { keyword: 'engineer', remoteOnly: true, experienceLevels: ['SE' as const, 'MI' as const], locationLabel: 'Boston, MA', filters: { cityId: 4930956, maxAge: '7d', remoteType: 'hybrid', employmentTypes: ['CONTRACT', 'FULL_TIME'], companyName: 'Acme', minimumSalary: 100000, includeUndisclosedSalaries: false, sortBy: 'relevance' } }
  expect(parseSearchUrl(serializeSearchUrl(search))).toEqual(search)
})
it('drops unsupported, duplicate and invalid values before requesting', () => {
  expect(parseSearchUrl('?q=engineer&level=BAD&level=SE&level=SE&employment=BAD&city=-1&salary=NaN&age=forever&sort=bad&company=%00')).toEqual({ keyword: 'engineer', remoteOnly: false, experienceLevels: ['SE'] })
  expect(parseSearchUrl('?q=' + 'a'.repeat(201))).toBeNull()
  expect(parseSearchUrl('?q=%00')).toBeNull()
  expect(parseSearchUrl('')).toBeNull()
})

it('round-trips a state and unrestricted remote preference and omits defaults', () => {
  const search = { keyword: 'design', remoteOnly: true, experienceLevels: [], locationLabel: 'California, US', filters: { stateId: 5332921 } }
  expect(parseSearchUrl(serializeSearchUrl(search))).toEqual(search)
  expect(serializeSearchUrl({ keyword: 'design', remoteOnly: false, experienceLevels: [], filters: { sortBy: 'published' } })).toBe('?q=design')
})
