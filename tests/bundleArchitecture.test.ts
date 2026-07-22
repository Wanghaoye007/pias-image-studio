import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('frontend bundle architecture', () => {
  it('keeps secondary management views out of the initial studio bundle', () => {
    const appSource = readFileSync(`${process.cwd()}/src/client/App.tsx`, 'utf8');
    const secondaryViewSource = readFileSync(`${process.cwd()}/src/client/pages/SecondaryViews.tsx`, 'utf8');

    expect(appSource).toMatch(/lazy\(\(\) => import\('\.\/pages\/SecondaryViews'\)\)/);
    expect(appSource).toMatch(/lazy\(\(\) => import\('\.\/workbench\/Workbench'\)\)/);
    expect(appSource).not.toMatch(
      /import\s*\{[^}]*SecondaryView[^}]*\}\s*from\s*['"]\.\/pages\/SecondaryViews['"]/s,
    );
    expect(appSource).toContain('secondaryRequested &&');
    expect(appSource).toContain("from './navigation/GlobalNav'");
    expect(appSource).not.toMatch(
      /import\s*\{[^}]*Workbench[^}]*\}\s*from\s*['"]\.\/workbench\/Workbench['"]/s,
    );
    expect(secondaryViewSource).not.toContain('export function GlobalNav');
  });
});
