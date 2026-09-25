// Bitwright - Sprite Engine
// Copyright (C) 2026 Afterhours Studio
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

/**
 * What the steps strip does with a gate that did not pass.
 *
 * This is the screen where the engine's judgement reaches a person, and the
 * failure worth catching is the quiet one: a strip that shows a verdict and
 * drops the `detail` and the `hint`, leaving the artist told that something is
 * wrong and not told what. Those two strings are the only part of the report
 * that names coordinates, so losing them costs everything the gate measured.
 * The strip shows counts in its bar and the full report in a popover, so these
 * tests open it the way a person would before reading it.
 *
 * It is also the screen where a person can go back or push through, so the
 * other half of these tests is about the two confirmations that guard those:
 * revisiting a done step keeps every layer, and forcing an advance past a
 * gate that has not passed is recorded, and both say so before they act.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StepRail } from '@/features/editor/tools/StepRail';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { STEPS } from '@/types/document';
import type {
  GateCheck,
  GateMetrics,
  GateReport,
  Layer,
  Palette,
  StepState,
} from '@/types/document';

/** Metrics the silhouette gate would have reported alongside its checks. */
const METRICS: GateMetrics = {
  filled: 818,
  regionSizes: [812, 4, 2],
  perimeter: 140,
  perimeterSquaredOverArea: 24,
  solidity: 0.71,
  orphanCount: 2,
  orphanFraction: 0.002,
  speckleFraction: 0.01,
  jaggySequences: 0,
  horizontalChangeRate: 0.12,
  pillowCorrelation: 0.2,
  lightVectors: [],
  lightMeanDegrees: null,
  lightStdDegrees: null,
  undirectedRegions: [],
};

/** One check that failed, with the prose Rust wrote beside the measurement. */
const BROKEN: GateCheck = {
  name: 'single-region',
  pass: false,
  detail: '3 disconnected regions; largest is 812px, others 4px and 2px',
  hint: 'Remove the stray pixels at (51,12) and (9,44), or connect them.',
};

/** One check that passed, which carries no hint because there is nothing to advise. */
const CLEAN: GateCheck = {
  name: 'reads-at-1x',
  pass: true,
  detail: 'silhouette fills 71 percent of its convex hull',
};

/** A two-slot palette, enough for a thumbnail to have something to draw. */
const PALETTE: Palette = {
  slots: [
    { index: 1, rgba: [20, 20, 30, 255], name: null, ramp: null, step: null },
    { index: 2, rgba: [200, 90, 60, 255], name: null, ramp: null, step: null },
  ],
  ramps: [],
};

/** The silhouette layer, two by two, half painted. */
const SILHOUETTE: Layer = {
  id: 'layer-silhouette',
  role: 'silhouette',
  ordinal: 10,
  visible: true,
  locked: false,
  opacity: 1,
  buffer: { width: 2, height: 2, data: [1, 1, 0, 0] },
};

/**
 * The store as it stands with a report on screen.
 *
 * @param gate - The report to show.
 * @param canAdvance - What `step_state` said about moving on.
 */
function open(gate: GateReport, canAdvance: boolean): void {
  const step: StepState = {
    assetId: 'asset-1',
    step: gate.step,
    canAdvance,
    gate,
  };
  useDocumentStore.setState({ assetId: 'asset-1', step, gate, loading: false, error: null });
}

/** Opens the gate report popover from the bar's summary. */
function openReport(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /^Gate report/ }));
  return screen.getByRole('region', { name: 'Gate report' });
}

/** The strip's own list of steps. */
function stepList(): HTMLElement {
  return screen.getByRole('list', { name: 'Workflow steps' });
}

beforeEach(() => {
  useDocumentStore.setState({
    assetId: null,
    step: null,
    gate: null,
    layers: [],
    palette: null,
    loading: false,
    error: null,
    revisit: vi.fn(),
  });
});

describe('StepRail', () => {
  it('counts the checks that passed and failed in the bar', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN, CLEAN], metrics: METRICS }, false);

    render(<StepRail />);

    const summary = screen.getByRole('button', { name: 'Gate report: 1 passed, 1 failed' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    // The report itself stays out of the way until asked for.
    expect(screen.queryByRole('region', { name: 'Gate report' })).not.toBeInTheDocument();
  });

  it('shows what a failing check measured and what to do about it', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN, CLEAN], metrics: METRICS }, false);

    render(<StepRail />);
    const report = openReport();

    expect(within(report).getByText('single-region')).toBeInTheDocument();
    expect(within(report).getByText(BROKEN.detail as string)).toBeInTheDocument();
    expect(within(report).getByText(BROKEN.hint as string)).toBeInTheDocument();
    expect(within(report).getByText('1 checks did not pass.')).toBeInTheDocument();
  });

  it('shows the checks that passed as well, so a clean gate is visibly a gate', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN, CLEAN], metrics: METRICS }, false);

    render(<StepRail />);
    const report = openReport();

    // A report that listed only failures would say nothing at all about a
    // sprite that is clean, which is the moment the artist most wants to know
    // it was measured rather than waved through.
    expect(within(report).getByText('reads-at-1x')).toBeInTheDocument();
    expect(within(report).getByText(CLEAN.detail as string)).toBeInTheDocument();
  });

  it('closes the report on Escape', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN], metrics: METRICS }, false);

    render(<StepRail />);
    openReport();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('region', { name: 'Gate report' })).not.toBeInTheDocument();
  });

  it('says the gate has not been run yet rather than showing empty counts', () => {
    const step: StepState = {
      assetId: 'asset-1',
      step: 'silhouette',
      canAdvance: false,
      gate: { step: 'silhouette', pass: false, checks: [], metrics: METRICS },
    };
    useDocumentStore.setState({ assetId: 'asset-1', step, gate: null });

    render(<StepRail />);

    expect(screen.getByText('Not checked')).toBeInTheDocument();
    const report = openReport();
    expect(
      within(report).getByText('The gates have not been run on this sprite yet.'),
    ).toBeInTheDocument();
  });

  it('refuses to offer an advance while the gate has not passed', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN], metrics: METRICS }, false);

    render(<StepRail />);

    expect(screen.getByRole('button', { name: 'Advance' })).toBeDisabled();
    // Checking again is the one thing that is always available: the pixels may
    // have changed since the report was made, by this window or by an agent.
    expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
  });

  it('offers the advance once the shell says the asset may take it', () => {
    const advance = vi.fn();
    open({ step: 'silhouette', pass: true, checks: [CLEAN], metrics: METRICS }, true);
    useDocumentStore.setState({ advance });

    render(<StepRail />);

    expect(within(openReport()).getByText('All 1 checks passed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }));
    expect(advance).toHaveBeenCalledWith();
  });

  it('checks the gate again on request', () => {
    const check = vi.fn();
    open({ step: 'silhouette', pass: false, checks: [BROKEN], metrics: METRICS }, false);
    useDocumentStore.setState({ check });

    render(<StepRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));

    expect(check).toHaveBeenCalled();
  });

  it('says why an advance was refused, in the reading language', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN], metrics: METRICS }, false);
    useDocumentStore.setState({ error: 'step.gate_failed' });

    render(<StepRail />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      "The current step's checks did not pass, so the sprite did not advance.",
    );
  });

  it('says nothing about a sprite that is not open', () => {
    render(<StepRail />);

    expect(screen.getByText('No sprite is open.')).toBeInTheDocument();
  });

  it('names the layer the current step paints', () => {
    open({ step: 'shadow', pass: true, checks: [CLEAN], metrics: METRICS }, true);

    render(<StepRail />);

    expect(screen.getByText('Layer: Core shadow + Deep shadow')).toBeInTheDocument();
  });

  it('lists all 11 steps in order and marks the current one', () => {
    open({ step: 'flats', pass: true, checks: [CLEAN], metrics: METRICS }, true);

    render(<StepRail />);

    const items = within(stepList()).getAllByRole('listitem');
    expect(items).toHaveLength(STEPS.length);
    expect(items[3]).toHaveTextContent(/# 4\s*Flats/);
    expect(within(stepList()).getByText('Flats').closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('makes a done card a button and leaves a later card inert', () => {
    open({ step: 'flats', pass: true, checks: [CLEAN], metrics: METRICS }, true);

    render(<StepRail />);

    // "Reference" and "Palette" precede "Flats" in STEPS, so they are done.
    expect(screen.getByRole('button', { name: 'Revisit Reference' })).toBeInTheDocument();
    // "Shadow" comes after "Flats", so it is ahead and not a button.
    expect(screen.queryByRole('button', { name: /Shadow/ })).not.toBeInTheDocument();
    expect(within(stepList()).getByText('Shadow')).toBeInTheDocument();
  });

  it('draws a thumbnail for a step whose layer exists and an icon for one that owns none', () => {
    open({ step: 'flats', pass: true, checks: [CLEAN], metrics: METRICS }, true);
    useDocumentStore.setState({ layers: [SILHOUETTE], palette: PALETTE });

    render(<StepRail />);

    expect(screen.getByTestId('step-thumbnail-silhouette')).toBeInTheDocument();
    // Flats has a role but no layer yet, so there is nothing to draw.
    expect(screen.queryByTestId('step-thumbnail-flats')).not.toBeInTheDocument();
    for (const step of ['reference', 'palette', 'cleanup', 'variation']) {
      expect(screen.getByTestId(`step-icon-${step}`)).toBeInTheDocument();
    }
  });

  it('asks first before revisiting a done step, and cancel calls nothing', () => {
    const revisit = vi.fn();
    open({ step: 'flats', pass: true, checks: [CLEAN], metrics: METRICS }, true);
    useDocumentStore.setState({ revisit });

    render(<StepRail />);

    fireEvent.click(screen.getByRole('button', { name: 'Revisit Reference' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(revisit).not.toHaveBeenCalled();
    // `getByRole` excludes `aria-hidden` elements by default, so a dialog that
    // has been dismissed but not unmounted no longer turns up here.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('revisits the chosen step once confirmed', () => {
    const revisit = vi.fn();
    open({ step: 'flats', pass: true, checks: [CLEAN], metrics: METRICS }, true);
    useDocumentStore.setState({ revisit });

    render(<StepRail />);

    fireEvent.click(screen.getByRole('button', { name: 'Revisit Reference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revisit' }));

    expect(revisit).toHaveBeenCalledWith('reference');
  });

  it("goes back one step from the bar's Revisit, behind the same confirmation", () => {
    const revisit = vi.fn();
    open({ step: 'flats', pass: true, checks: [CLEAN], metrics: METRICS }, true);
    useDocumentStore.setState({ revisit });

    render(<StepRail />);

    fireEvent.click(screen.getByRole('button', { name: 'Go back to Silhouette' }));
    expect(revisit).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revisit' }));

    expect(revisit).toHaveBeenCalledWith('silhouette');
  });

  it("disables the bar's Revisit on the first step, which has nothing before it", () => {
    open({ step: 'reference', pass: true, checks: [], metrics: METRICS }, true);

    render(<StepRail />);

    expect(screen.getByRole('button', { name: 'Revisit' })).toBeDisabled();
  });

  it('offers a forced advance only while the gate fails and the step is not the last', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN], metrics: METRICS }, false);

    render(<StepRail />);

    expect(screen.getByRole('button', { name: 'Advance anyway' })).toBeInTheDocument();
  });

  it('offers no forced advance once the gate has passed', () => {
    open({ step: 'silhouette', pass: true, checks: [CLEAN], metrics: METRICS }, true);

    render(<StepRail />);

    expect(screen.queryByRole('button', { name: 'Advance anyway' })).not.toBeInTheDocument();
  });

  it('offers no forced advance before the gate has been checked', () => {
    // Right after a revisit the new step has no report yet: there is no
    // failing gate to override, so forcing would skip a gate nobody ran.
    const step: StepState = {
      assetId: 'asset-1',
      step: 'silhouette',
      canAdvance: false,
      gate: { step: 'silhouette', pass: false, checks: [], metrics: METRICS },
    };
    useDocumentStore.setState({
      assetId: 'asset-1',
      step,
      gate: null,
      loading: false,
      error: null,
    });

    render(<StepRail />);

    expect(screen.queryByRole('button', { name: 'Advance anyway' })).not.toBeInTheDocument();
  });

  it('offers no forced advance on the last step', () => {
    open({ step: 'variation', pass: false, checks: [BROKEN], metrics: METRICS }, false);

    render(<StepRail />);

    expect(screen.queryByRole('button', { name: 'Advance anyway' })).not.toBeInTheDocument();
  });

  it('forces an advance once confirmed, listing the failing checks first', () => {
    const advance = vi.fn();
    open({ step: 'silhouette', pass: false, checks: [BROKEN], metrics: METRICS }, false);
    useDocumentStore.setState({ advance });

    render(<StepRail />);

    fireEvent.click(screen.getByRole('button', { name: 'Advance anyway' }));
    const dialog = screen.getByRole('dialog');
    // Named where the reader will see them: inside the confirmation, not only
    // in the report behind it.
    expect(within(dialog).getByText('single-region')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Advance anyway' }));

    expect(advance).toHaveBeenCalledWith({ force: true });
  });
});
