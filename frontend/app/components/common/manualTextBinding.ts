/** Presentation-only binding. The data engine owns the form baseline and persistence. */
export interface ManualTextBinding {
  active: boolean;
  value: string;
  busy: boolean;
  begin(): Promise<void>;
  update(value: string): Promise<void>;
  save(value: string): Promise<void>;
  cancel(): Promise<void>;
}
