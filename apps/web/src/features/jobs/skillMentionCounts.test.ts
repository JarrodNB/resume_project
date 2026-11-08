/** Checks literal mention counts without treating parts of larger skill names as matches. */
import { expect, it, vi } from 'vitest'
import { skillMentionCount } from './skillMentionCounts'

it('counts repeated literal mentions regardless of capitalization', () => {
  expect(skillMentionCount('Python, PYTHON and python', 'Python')).toBe(3)
})

it('rejects substrings and aliases, including punctuation-bearing skill suffixes', () => {
  expect(skillMentionCount('JavaScript JAVA Java', 'Java')).toBe(2)
  expect(skillMentionCount('JavaScript', 'JS')).toBe(0)
  expect(skillMentionCount('C C++ C# Objective-C C++17 C#developer', 'C')).toBe(1)
  expect(skillMentionCount('C++ C++17 C++++', 'C++')).toBe(1)
  expect(skillMentionCount('.NET .NETCore ASP.NET', '.NET')).toBe(1)
})

it.each([
  ['C++, c++ and C#.', 'C++', 2],
  ['C#, c# and C++.', 'C#', 2],
  ['.NET, .net and NET.', '.NET', 2],
  ['React.js, ReactXjs', 'React.js', 1],
  ['a+b aab a+b', 'a+b', 2],
  ['Python. (Python); Python/Python', 'Python', 4],
  ['éPython Pythoné Python', 'Python', 1],
  ['project management; management', 'project management', 1],
  ['project management; management', 'management', 2],
  ['project  management', 'project management', 0],
  ['aaa', 'aa', 0],
  ['', 'Python', 0],
  ['anything', ' ', 0],
])('counts %j for the literal skill %j as %i', (description, skill, count) => {
  expect(skillMentionCount(description, skill)).toBe(count)
})

it('reuses recent patterns but releases old ones after many skill changes', async () => {
  vi.resetModules()
  const { skillMentionCount: count } = await import('./skillMentionCounts')
  const compile = vi.spyOn(globalThis, 'RegExp')
  // matchAll also clones RegExp objects; count only compilation from a pattern string.
  const compilations = () => compile.mock.calls.filter(([pattern]) => typeof pattern === 'string').length
  try {
    expect(count('C++ and c++.', 'C++')).toBe(2)
    expect(count('C++17 C++', 'C++')).toBe(1)
    expect(compilations()).toBe(1)

    for (let index = 0; index < 512; index++) {
      const skill = `Skill-${index}`
      expect(count(`${skill}, ${skill}`, skill)).toBe(2)
    }
    const beforeRevisit = compilations()
    expect(count('C++ and c++.', 'C++')).toBe(2)
    expect(compilations()).toBe(beforeRevisit + 1)
    expect(count('C++17 C++', 'C++')).toBe(1)
    expect(compilations()).toBe(beforeRevisit + 1)
  } finally {
    compile.mockRestore()
  }
})
