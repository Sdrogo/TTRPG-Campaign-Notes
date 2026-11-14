import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFillHeight } from '../../hooks/useFillHeight';

function Unattached() {
  const ref = useRef<HTMLDivElement>(null);
  return <div>{useFillHeight(ref)}</div>;
}

function Probe({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useFillHeight(ref, enabled);
  return <div ref={ref}>{height}</div>;
}

describe('useFillHeight', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fills from where the element starts to the bottom of the screen, less the page margin', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 134 } as DOMRect);
    render(<Probe />);
    expect(screen.getByText('calc(100dvh - 150px)')).toBeInTheDocument();
  });

  it('keeps the fallback when turned off', () => {
    render(<Probe enabled={false} />);
    expect(screen.getByText('calc(100dvh - 190px)')).toBeInTheDocument();
  });

  it('keeps the fallback while the element is not on the page', () => {
    render(<Unattached />);
    expect(screen.getByText('calc(100dvh - 190px)')).toBeInTheDocument();
  });
});
