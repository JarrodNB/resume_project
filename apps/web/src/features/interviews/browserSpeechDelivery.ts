/** Choose a consistent English voice and short speaking phrases from saved dialogue.
 * Voice availability belongs to the browser; text is only split, never rewritten.
 */
export function selectInterviewVoice(voices: SpeechSynthesisVoice[]) {
  const english = voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang))
  return english.find((voice) => /google us english|google uk english female|microsoft aria|microsoft jenny|samantha/i.test(voice.name))
    ?? english.find((voice) => voice.default) ?? english[0] ?? null
}

export function interviewSpeechChunks(text: string): string[] {
  const sentences = text.trim().match(/[\s\S]+?(?:[.!?]+["'’”)\]]*(?=\s|$)|$)/g) ?? []
  const chunks: string[] = []
  for (const sentence of sentences) {
    let rest = sentence.trim()
    while (Array.from(rest).length > 180) {
      const characters = Array.from(rest)
      const prefix = characters.slice(0, 180).join('')
      let boundary = Math.max(prefix.lastIndexOf(','), prefix.lastIndexOf(';'), prefix.lastIndexOf(':')) + 1
      if (boundary < prefix.length / 2) boundary = prefix.lastIndexOf(' ')
      if (boundary < prefix.length / 2) boundary = prefix.length
      chunks.push(rest.slice(0, boundary).trim())
      rest = rest.slice(boundary).trim()
    }
    if (rest) chunks.push(rest)
  }
  return chunks
}
