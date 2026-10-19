// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
  compositionColors,
  compositionSegments,
  installCompositionClauses,
  installXtermCompositionClauses,
} from '../../src/renderer/utils/ime-composition';

/**
 * Issue #301: Microsoft Bopomofo moves a caret through a multi-character
 * composition and xterm drew it as one flat block, so the user could not see
 * which character they were on.
 */
describe('compositionSegments (#301)', () => {
  it('places a caret inside the composition — Bopomofo after ←', () => {
    // textarea "ab" already consumed, composition "你好嗎" starts at 2, caret after 你
    expect(compositionSegments('你好嗎', 2, 3, 3)).toEqual({ before: '你', active: '', after: '好嗎', caret: true });
  });

  it('a caret at the end is still a caret, not a highlight', () => {
    expect(compositionSegments('你好', 0, 2, 2)).toEqual({ before: '你好', active: '', after: '', caret: true });
  });

  it('highlights a selected clause when the IME reports a range', () => {
    expect(compositionSegments('きょうは', 0, 0, 3)).toEqual({ before: '', active: 'きょう', after: 'は', caret: false });
  });

  it('normalises a backwards selection', () => {
    expect(compositionSegments('abc', 0, 2, 1)).toEqual({ before: 'a', active: 'b', after: 'c', caret: false });
  });

  it('draws nothing it was not told — a selection outside the composition is not a report about it', () => {
    expect(compositionSegments('你好', 2, 1, 1)).toBeNull();
    expect(compositionSegments('你好', 0, 0, 5)).toBeNull();
    expect(compositionSegments('', 0, 0, 0)).toBeNull();
    expect(compositionSegments('你好', 0, Number.NaN, 1)).toBeNull();
  });
});

describe('compositionColors', () => {
  it('reads the live theme, with xterm fallbacks', () => {
    expect(compositionColors({ foreground: '#eee', background: '#111', selectionBackground: '#345' }))
      .toEqual({ foreground: '#eee', background: '#111', cursor: '#eee', selection: '#345' });
    expect(compositionColors(undefined).background).toBe('#000000');
  });
});

describe('installCompositionClauses (#301)', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => { dispose?.(); dispose = null; document.body.replaceChildren(); });

  function setup(composing = true) {
    const textarea = document.createElement('textarea');
    const view = document.createElement('div');
    document.body.append(textarea, view);
    dispose = installCompositionClauses({
      textarea,
      view,
      isComposing: () => composing,
      compositionStart: () => 0,
      colors: () => compositionColors({ foreground: '#eee', background: '#111' }),
    });
    return { textarea, view };
  }

  it('redraws the view with a caret once the textarea holds the new selection', () => {
    const { textarea, view } = setup();
    textarea.value = '你好嗎';
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new Event('input'));
    expect(view.textContent).toBe('你好嗎');
    expect(view.querySelector('.wmux-ime__caret')).not.toBeNull();
    expect(view.querySelector('.wmux-ime__text')?.textContent).toBe('你');
    expect(view.style.background).toBe('rgb(17, 17, 17)');
  });

  it('follows a selection-only move (← inside the composition)', () => {
    const { textarea, view } = setup();
    textarea.value = '你好嗎';
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(new Event('input'));
    textarea.setSelectionRange(0, 0);
    textarea.dispatchEvent(new Event('keyup'));
    expect(view.firstChild?.textContent).toBe('');
    expect(view.children[1].className).toBe('wmux-ime__caret');
  });

  it('touches nothing when xterm is not composing', () => {
    const { textarea, view } = setup(false);
    view.textContent = 'untouched';
    textarea.value = 'x';
    textarea.dispatchEvent(new Event('input'));
    expect(view.textContent).toBe('untouched');
  });

  it('stops listening once disposed', () => {
    const { textarea, view } = setup();
    dispose?.();
    dispose = null;
    textarea.value = '你';
    textarea.dispatchEvent(new Event('input'));
    expect(view.childElementCount).toBe(0);
  });

  it('the xterm adapter installs nothing without a composition view', () => {
    const textarea = document.createElement('textarea');
    expect(() => installXtermCompositionClauses({ options: {} }, {}, textarea)()).not.toThrow();
  });
});
