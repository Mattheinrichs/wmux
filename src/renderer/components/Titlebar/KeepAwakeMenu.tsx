import React, { useState, useRef, useEffect, useCallback } from 'react';
import { IconCoffee } from './icons';
import { KeepAwakeState, KeepAwakeMode } from '../../../shared/types';
import { useT, type TranslationKey } from '../../i18n';
import { useStore } from '../../store';

export const KEEP_AWAKE_OPTIONS: { mode: KeepAwakeMode; labelKey: TranslationKey; label: string; hintKey: TranslationKey; hint: string }[] = [
  { mode: 'always', labelKey: 'titlebar.keepAwake.on', label: 'On', hintKey: 'titlebar.keepAwake.onHint', hint: 'Keep this computer awake continuously' },
  { mode: 'smart', labelKey: 'titlebar.keepAwake.smart', label: 'Smart', hintKey: 'titlebar.keepAwake.smartHint', hint: 'Stay awake while an agent is working' },
  { mode: 'off', labelKey: 'titlebar.keepAwake.off', label: 'Off', hintKey: 'titlebar.keepAwake.offHint', hint: 'Allow normal system sleep behavior' },
];

export default function KeepAwakeMenu() {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [awakeState, setAwakeState] = useState<KeepAwakeState>({
    mode: 'smart',
    isActive: false,
    preventDisplaySleep: false,
    blockerType: 'prevent-app-suspension',
  });

  useEffect(() => {
    let unmounted = false;
    window.wmux?.awake?.getState?.().then((st: KeepAwakeState) => {
      if (!unmounted && st) setAwakeState(st);
    }).catch(() => {});

    const unsubscribe = window.wmux?.awake?.onStateChange?.((st: KeepAwakeState) => {
      if (!unmounted && st) setAwakeState(st);
    });

    return () => {
      unmounted = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const selectMode = useCallback((mode: KeepAwakeMode) => {
    window.wmux?.awake?.setMode?.(mode).then((st: KeepAwakeState) => {
      if (st) {
        setAwakeState(st);
        useStore.getState().setWorkspacePrefs({ keepAwakeMode: st.mode });
      }
    }).catch(() => {});
    setIsOpen(false);
  }, []);

  const activeOption = KEEP_AWAKE_OPTIONS.find((o) => o.mode === awakeState.mode) ?? KEEP_AWAKE_OPTIONS[2];
  const modeLabel = t(activeOption.labelKey, activeOption.label);
  const activeLabel = t(
    awakeState.isActive ? 'titlebar.keepAwake.active' : 'titlebar.keepAwake.inactive',
    awakeState.isActive ? 'Active' : 'Inactive'
  );
  const statusLabel = `${modeLabel} · ${activeLabel}`;

  return (
    <div ref={containerRef} className="keep-awake-menu" style={{ position: 'relative' }}>
      <button
        className={`titlebar__btn${awakeState.isActive ? ' titlebar__btn--awake-active' : ''}${awakeState.mode === 'off' ? ' titlebar__btn--awake-off' : ''}${awakeState.mode !== 'off' && !awakeState.isActive ? ' titlebar__btn--awake-armed' : ''}`}
        onClick={() => setIsOpen((v) => !v)}
        title={
          awakeState.mode === 'smart'
            ? `Keep Awake: Smart (${awakeState.isActive ? 'Active — agent working' : 'Armed — waiting for agent'})`
            : awakeState.mode === 'always'
            ? 'Keep Awake: On'
            : 'Keep Awake: Off'
        }
        aria-label="Keep computer awake menu"
        aria-expanded={isOpen}
      >
        <IconCoffee active={awakeState.isActive} />
      </button>
      {isOpen && (
        <div className="keep-awake-panel" onClick={(e) => e.stopPropagation()}>
          <div className="keep-awake-panel__header">
            <span className="keep-awake-panel__title">{t('titlebar.keepAwake.title', 'Keep computer awake')}</span>
            <span className="keep-awake-panel__status">{statusLabel}</span>
          </div>
          <div className="keep-awake-panel__list">
            {KEEP_AWAKE_OPTIONS.map((opt) => (
              <div
                key={opt.mode}
                className="keep-awake-panel__item"
                onClick={() => selectMode(opt.mode)}
              >
                <span className={`keep-awake-panel__radio${awakeState.mode === opt.mode ? ' keep-awake-panel__radio--selected' : ''}`} />
                <div className="keep-awake-panel__content">
                  <span className="keep-awake-panel__label">{t(opt.labelKey, opt.label)}</span>
                  <span className="keep-awake-panel__hint">{t(opt.hintKey, opt.hint)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
