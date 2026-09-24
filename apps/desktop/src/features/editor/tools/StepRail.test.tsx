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
 * What the step rail does with a gate that did not pass.
 *
 * This is the screen where the engine's judgement reaches a person, and the
 * failure worth catching is the quiet one: a rail that shows a verdict and
 * drops the `detail` and the `hint`, leaving the artist told that something is
 * wrong and not told what. Those two strings are the only part of the report
 * that names coordinates, so losing them costs everything the gate measured.
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
import type { GateCheck, GateMetrics, GateReport, StepState } from '@/types/document';

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

beforeEach(() => {
  useDocumentStore.setState({
    assetId: null,
    step: null,
    gate: null,
    loading: false,
    error: null,
    revisit: vi.fn(),
  });
});

describe('StepRail', () => {
  it('shows what a failing check measured and what to do about it', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN, CLEAN], metrics: METRICS }, false);

    render(<StepRail />);

    expect(screen.getByText('single-region')).toBeInTheDocument();
    expect(screen.getByText(BROKEN.detail as string)).toBeInTheDocument();
    expect(screen.getByText(BROKEN.hint as string)).toBeInTheDocument();
    expect(screen.getByText('1 checks did not pass.')).toBeInTheDocument();
  });

  it('shows the checks that passed as well, so a clean gate is visibly a gate', () => {
    open({ step: 'silhouette', pass: false, checks: [BROKEN, CLEAN], metrics: METRICS }, false);

    render(<StepRail />);

    // A rail that listed only failures would say nothing at all about a sprite
    // that is clean, which is the moment the artist most wants to know it was
    // measured rather than waved through.
    expect(screen.getByText('reads-at-1x')).toBeInTheDocument();
    expect(screen.getByText(CLEAN.detail as string)).toBeInTheDocument();
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
    open({ step: 'silhouette', pass: true, checks: [CLEAN], metrics: METRICS }, true);

    render(<StepRail />);

    expect(screen.getByText('All 1 checks passed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advance' })).toBeEnabled();
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

  it('lists all 11 steps and marks the current one', () => {
    open({ step: 'flats', pass: true, checks: [CLEAN], metrics: METRICS }, true);

    render(<StepRail />);

    // The rail's own ordered list, scoped so the check rows below it cannot
    // answer for the steps.
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(STEPS.length);
    expect(within(list).getByText('Flats')).toHaveAttribute('aria-current', 'step');
  });

  it('makes a done step a button and leaves an ahead step plain text', () => {
    open({ step: 'flats', pass: true, checks: [CLEAN], metrics: METRICS }, true);

    render(<StepRail />);

    // "Reference" and "Palette" precede "Flats" in STEPS, so they are done.
    expect(screen.getByRole('button', { name: 'Revisit Reference' })).toBeInTheDocument();
    // "Shadow" comes after "Flats", so it is ahead and not a button.
    expect(screen.queryByRole('button', { name: /Shadow/ })).not.toBeInTheDocument();
    expect(screen.getByText('Shadow')).toBeInTheDocument();
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
