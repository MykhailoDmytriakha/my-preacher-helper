import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { useAnalysisAddress } from '@/components/bible/analysis/useAnalysisAddress';
import { useModalLayer } from '@/hooks/useModalLayer';

function AnalysisScreen({ onClose }: { onClose: () => void }) {
  const layer = useModalLayer({ onClose, browserHistory: false });
  useAnalysisAddress({ opening: { kind: 'open', id: 'analysis-one' }, id: 'analysis-one', mode: 'view', gone: false, onGone: onClose, onBack: onClose });
  return <div {...layer} role="dialog" aria-label="Analysis" style={{ zIndex: 200 }}><button onClick={onClose}>Done</button></div>;
}

function Page() {
  const [lower, setLower] = useState(true);
  const [analysis, setAnalysis] = useState(false);
  const layer = useModalLayer({ active: lower, onClose: () => setLower(false) });
  return <>
    {lower && <div {...layer} role="dialog" aria-label="Lower window" style={{ zIndex: 100 }}><button onClick={() => setAnalysis(true)}>Open analysis</button></div>}
    {analysis && <AnalysisScreen onClose={() => setAnalysis(false)} />}
  </>;
}

const back = async () => { await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 40)); }); };
afterEach(async () => { cleanup(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); }); });

it('gives a URL-bearing top screen one entry and its own Back, then restores the lower window guard', async () => {
  window.history.pushState(null, '', '/studies');
  render(<Page />);
  const before = window.history.length;
  fireEvent.click(screen.getByRole('button', { name: 'Open analysis' }));
  expect(window.history.length).toBe(before + 1);
  expect(window.location.search).toContain('analysis=analysis-one');
  await back();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Analysis' })).not.toBeInTheDocument());
  expect(screen.getByRole('dialog', { name: 'Lower window' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/studies');
  await back();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lower window' })).not.toBeInTheDocument());
  expect(window.location.pathname).toBe('/studies');
});
