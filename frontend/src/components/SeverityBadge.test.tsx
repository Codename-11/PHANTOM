// SeverityBadge — variant per severity. The badge ships a data-severity
// attribute that downstream surfaces can target, and a uppercase label
// so the audit timeline reads consistently in the cool-slate UI.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SeverityBadge } from './SeverityBadge';

describe('SeverityBadge', () => {
  it.each([
    ['critical', 'crit', 'CRIT'],
    ['crit',     'crit', 'CRIT'],
    ['high',     'high', 'HIGH'],
    ['medium',   'med',  'MED'],
    ['med',      'med',  'MED'],
    ['low',      'low',  'LOW'],
    ['info',     'info', 'INFO'],
    ['',         'info', 'INFO'],
    ['something-else', 'info', 'INFO'],
  ])('maps severity "%s" → variant=%s, label=%s', (input, variant, label) => {
    render(<SeverityBadge severity={input} />);
    const el = screen.getByTestId('severity-badge');
    expect(el).toHaveAttribute('data-severity', variant);
    expect(el).toHaveTextContent(label);
  });

  it('accepts null without crashing', () => {
    render(<SeverityBadge severity={null} />);
    expect(screen.getByTestId('severity-badge')).toHaveAttribute('data-severity', 'info');
  });
});
