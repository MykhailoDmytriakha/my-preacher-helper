import { fireEvent, render, screen } from '@testing-library/react';

import { OutlinePointGuidanceTooltip, SermonSectionGuidanceTooltip } from '@/components/SermonGuidanceTooltips';

const words: Record<string, string> = {
  'structure.outlineHelp.ariaLabel': 'Outline guidance',
  'structure.outlineHelp.title': 'Outline help',
  'structure.introductionInfo.ariaLabel': 'Introduction guidance',
  'structure.introductionInfo.title': 'Introduction help',
};
const t = (key: string) => words[key] ?? key;
const initialViewport = { width: window.innerWidth, height: window.innerHeight };
let triggerTop = 100;
const viewport = (height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
};
const isPanel = (element: HTMLElement) => element.classList.contains('absolute');
const naturalHeight = (element: HTMLElement) => element.textContent?.includes('Outline help') ? 206 : 210;
const box = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, right: left + width, top, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });
const measured = (element: HTMLElement): DOMRect => {
  if (element.dataset.testid === 'scroll-column') return box(0, -600, 800, 1500);
  if (element.classList.contains('relative') && element.querySelector('button[aria-label]')) return box(300, triggerTop, 32, 32);
  if (!isPanel(element)) return box(0, 0, 0, 0);
  const cap = Number.parseFloat(element.style.maxHeight);
  const height = Math.min(naturalHeight(element), Number.isFinite(cap) ? cap : Infinity);
  const width = element.textContent?.includes('Outline help') ? 300 : 320;
  const shift = element.style.translate?.split(/\s+/) ?? [];
  const left = (element.classList.contains('right-0') ? 332 - width : 300) + (Number.parseFloat(shift[0]) || 0);
  const top = (element.classList.contains('bottom-full') ? triggerTop - height - 8 : triggerTop + 40) + (Number.parseFloat(shift[1]) || 0);
  return box(left, top, width, height);
};
const renderOutline = () => render(<div data-testid="scroll-column" className="overflow-y-auto" style={{ overflowY: 'auto' }}><OutlinePointGuidanceTooltip t={t} popoverAlignment="right" /></div>);
const openOutline = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Outline guidance' }));
  return screen.getByText('Outline help').parentElement!.parentElement!;
};
const openSection = () => {
  render(<SermonSectionGuidanceTooltip t={t} section="introduction" />);
  fireEvent.click(screen.getByRole('button', { name: 'Introduction guidance' }));
  return screen.getByText('Introduction help').parentElement!.parentElement!;
};

beforeEach(() => {
  triggerTop = 100; viewport(1000);
  jest.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(0);
  jest.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(0);
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return measured(this); });
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.testid === 'scroll-column' ? 800 : 0; });
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.testid === 'scroll-column' ? 1500 : measured(this).height; });
  jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return isPanel(this) ? naturalHeight(this) : 0; });
});
afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: initialViewport.width, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: initialViewport.height, configurable: true, writable: true });
});

it('keeps outline help visible when its column begins above the viewport', () => {
  renderOutline(); const panel = openOutline(); const rect = panel.getBoundingClientRect();
  expect(rect.top).toBeGreaterThanOrEqual(16);
  expect(rect.bottom).toBeLessThanOrEqual(984);
});

it('preserves the preferred above placement when it fits', () => {
  triggerTop = 500; renderOutline(); const panel = openOutline();
  expect(panel.getBoundingClientRect().bottom).toBe(492);
});

it('keeps section help below its trigger when there is room', () => {
  triggerTop = 200; const panel = openSection();
  expect(panel.getBoundingClientRect().top).toBe(240);
});

it('opens section help above a trigger near the bottom of a short window', () => {
  triggerTop = 520; viewport(600); const panel = openSection();
  expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(512);
  expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(16);
});

it('repositions open guidance after resize and scroll', () => {
  triggerTop = 500; renderOutline(); const panel = openOutline();
  triggerTop = 100; viewport(600); fireEvent(window, new Event('resize'));
  expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(16);
  triggerTop = 530; fireEvent.scroll(document);
  expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(584);
});

it('keeps tall help scrollable without covering the visible trigger', () => {
  triggerTop = 80; viewport(180); renderOutline(); const panel = openOutline(); const rect = panel.getBoundingClientRect();
  expect(rect.top).toBeGreaterThanOrEqual(16);
  expect(rect.bottom).toBeLessThanOrEqual(72);
  expect(rect.height).toBeGreaterThan(0);
  expect(panel.style.overflowY).toBe('auto');
  expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
});

it('retains inside clicks, outside dismissal and reopening', () => {
  renderOutline(); const panel = openOutline();
  fireEvent.mouseDown(panel); expect(screen.getByText('Outline help')).toBeInTheDocument();
  fireEvent.mouseDown(document.body); expect(screen.queryByText('Outline help')).not.toBeInTheDocument();
  openOutline(); expect(screen.getByText('Outline help')).toBeInTheDocument();
});

it('restores owned geometry styles when guidance closes', () => {
  triggerTop = 80; viewport(180); renderOutline(); const panel = openOutline();
  fireEvent.mouseDown(document.body);
  expect(panel.style.translate ?? '').toBe(''); expect(panel.style.maxWidth).toBe('');
  expect(panel.style.maxHeight).toBe(''); expect(panel.style.overflowY).toBe('');
});
