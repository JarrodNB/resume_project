/** User-facing setup choices also label the saved configuration after preparation. */
export const typeOptions = [
  { value: 'mixed', label: 'Mixed Interview', description: 'Behavioural + role questions. Closest to a real loop.' },
  { value: 'behavioral', label: 'Behavioural', description: 'Past experience, teamwork, conflict, leadership. STAR-focused.' },
  { value: 'technical', label: 'Technical / Role', description: 'Role knowledge, judgement and problem-solving depth.' },
  { value: 'screening', label: 'HR Screening', description: 'Motivation, background, logistics and culture fit.' },
]
export const difficultyOptions = [
  { value: 'warm_up', label: 'Warm-up', description: 'Supportive pace, foundational questions.' },
  { value: 'realistic', label: 'Realistic', description: 'Matches a typical on-site / video round.' },
  { value: 'stretch', label: 'Stretch', description: 'Probing follow-ups and harder scenarios.' },
]
export const interviewerOptions = [
  { value: 'maya', label: 'Maya — Friendly Coach', description: 'Warm, encouraging, gives you room to think.' },
  { value: 'daniel', label: 'Daniel — Professional Hiring Manager', description: 'Neutral and structured, like a real panel member.' },
  { value: 'priya', label: 'Priya — Tough Interviewer', description: 'Direct, presses for specifics and measurable impact. Probes after you submit your answer.' },
]
export const lengthOptions = [
  { value: '5', label: 'Short', description: '5 core questions · ~10 min' },
  { value: '8', label: 'Standard', description: '8 core questions · ~20 min' },
  { value: '12', label: 'Full loop', description: '12 core questions · ~30 min' },
]
export const focusOptions: Record<string, string> = { communication: 'Communication', problem_solving: 'Problem Solving', leadership: 'Leadership', teamwork: 'Teamwork', conflict: 'Conflict', impact_metrics: 'Impact & Metrics', technical_depth: 'Technical Depth', adaptability: 'Adaptability', ownership: 'Ownership', customer_focus: 'Customer Focus' }
