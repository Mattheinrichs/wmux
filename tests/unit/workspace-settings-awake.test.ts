import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import WorkspaceSettings from '../../src/renderer/components/Settings/WorkspaceSettings';
import { useStore } from '../../src/renderer/store';

describe('WorkspaceSettings Keep Awake UI', () => {
  beforeEach(() => {
    useStore.setState({
      workspacePrefs: {
        ...useStore.getState().workspacePrefs,
        keepAwakeMode: 'smart',
        preventDisplaySleep: false,
      },
    });
  });

  it('renders Keep computer awake options and display sleep toggle', () => {
    const html = ReactDOMServer.renderToString(React.createElement(WorkspaceSettings));
    expect(html).toContain('Keep computer awake');
    expect(html).toContain('Smart (when agents are active)');
    expect(html).toContain('Always (keep awake while wmux is open)');
    expect(html).toContain('Off (system defaults)');
    expect(html).toContain('Keep display awake');
  });

  it('updates store state when keepAwakeMode or preventDisplaySleep change', () => {
    useStore.getState().setWorkspacePrefs({ keepAwakeMode: 'always', preventDisplaySleep: true });
    expect(useStore.getState().workspacePrefs.keepAwakeMode).toBe('always');
    expect(useStore.getState().workspacePrefs.preventDisplaySleep).toBe(true);
  });
});
