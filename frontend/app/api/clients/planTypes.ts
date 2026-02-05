export type PlanStyle = 'memory' | 'narrative' | 'exegetical';

export interface PlanContext {
  previousPoint?: { text: string } | null;
  nextPoint?: { text: string } | null;
  section?: 'introduction' | 'main' | 'conclusion';
}
