/**
 * App palette — dark theme matching the Task Buddy web app.
 * Background slate-900, surfaces slate-800/700, accent #C2A388.
 */
export const Colors = {
  background: '#0F172A', // slate-900
  backgroundElement: '#1E293B', // slate-800
  backgroundSelected: '#334155', // slate-700
  border: '#334155', // slate-700
  text: '#F1F5F9', // slate-100
  textSecondary: '#94A3B8', // slate-400
  textMuted: '#64748B', // slate-500
  accent: '#C2A388',
  danger: '#F87171', // red-400
  success: '#4ADE80', // green-400
} as const;

export const Spacing = {
  two: 8,
  three: 12,
  four: 16,
  five: 24,
} as const;
