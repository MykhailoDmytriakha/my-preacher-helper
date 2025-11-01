export type TimerPhase = 'introduction' | 'main' | 'conclusion' | 'finished';

export interface PhaseDefinition {
  color: string;
  label: string;
  ratio: number;
  description: string;
}

export const PHASE_DEFINITIONS: Record<TimerPhase, PhaseDefinition> = {
  introduction: {
    color: '#FCD34D',
    label: 'Introduction',
    ratio: 0.2,
    description: 'Opening and context setting'
  },
  main: {
    color: '#3B82F6',
    label: 'Main Content',
    ratio: 0.8,
    description: 'Core message delivery'
  },
  conclusion: {
    color: '#10B981',
    label: 'Conclusion',
    ratio: 0.0,
    description: 'Summary and call to action'
  },
  finished: {
    color: '#EF4444',
    label: 'Finished',
    ratio: 0.0,
    description: 'Timer completed'
  }
};

export const PHASE_LABELS: Record<TimerPhase, string> = {
  introduction: 'Introduction',
  main: 'Main Part',
  conclusion: 'Conclusion',
  finished: 'Finished'
};