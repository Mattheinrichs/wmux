import React, { useState, useRef, useEffect, useCallback } from 'react';
import { IconCoffee } from './icons';
import type { KeepAwakeState, KeepAwakeMode } from '../../../shared/types';
import { useT, type TranslationKey } from '../../i18n';
import { useKeepAwake } from '../../hooks/useKeepAwake';

export const KEEP_AWAKE_OPTIONS: { mode: KeepAwakeMode; labelKey: TranslationKey; label: string; hintKey: TranslationKey; hint: string }[] = [
  { mode: 'always', labelKey: 'titlebar.keepAwake.on', label: 'On', hintKey: 'titlebar.keepAwake.onHint', hint: 'Keep this computer awake continuously' },
  { mode: 'smart', labelKey: 'titlebar.keepAwake.smart', label: 'Smart', hintKey: 'titlebar.keepAwake.smartHint', hint: 'Stay awake while an agent is working' },
  { mode: 'off', labelKey: 'titlebar.keepAwake.off', label: 'Off', hintKey: 'titlebar.keepAwake.offHint', hint: 'Allow normal system sleep behavior' },
];

function tooltipKey(state: KeepAwakeState): TranslationKey {
  if (state.mode === 'always') return 'titlebar.keepAwake.tooltipOn';
  if (state.mode === 'off') return 'titlebar.keepAwake.tooltipOff';
  return state.isActive ? 'titlebar.keepAwake.tooltipSmartActive' : 'titlebar.keepAwake.tooltipSmartArmed';
}

function buttonClass(state: KeepAwakeState): string {
  if (state.isActive) return 'titlebar__btn titlebar__btn--awake-active';
  if (state.mode === 'off') return 'titlebar__btn titlebar__btn--awake-off';
  return 'titlebar__btn titlebar__btn--awake-armed';
}

export default function KeepAwakeMenu() {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Main holds the mode; every window's menu and the Settings panel read it from there.
  const { state: awakeState, setMode } = useKeepAwake();

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const selectMode = useCallback((mode: KeepAwakeMode) => {
    setMode(mode);
    setIsOpen(false);
  }, [setMode]);

  const onItemKeyDown = useCallback((e: React.KeyboardEvent, mode: KeepAwakeMode) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectMode(mode);
    }
  }, [selectMode]);

  const activeOption = KEEP_AWAKE_OPTIONS.find((o) => o.mode === awakeState.mode) ?? KEEP_AWAKE_OPTIONS[2];
  const modeLabel = t(activeOption.labelKey, activeOption.label);
  const activeLabel = awakeState.isActive
    ? t('titlebar.keepAwake.active', 'Active')
    : t('titlebar.keepAwake.inactive', 'Inactive');
  const statusLabel = `${modeLabel} · ${activeLabel}`;
  const title = t('titlebar.keepAwake.title', 'Keep computer awake');

  return (
    <div ref={containerRef} className="keep-awake-menu" style={{ position: 'relative' }}>
      <button
        className={buttonClass(awakeState)}
        onClick={() => setIsOpen((v) => !v)}
        title={t(tooltipKey(awakeState))}
        aria-label={t('titlebar.keepAwake.ariaLabel', 'Keep computer awake menu')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <IconCoffee active={awakeState.isActive} />
      </button>
      {isOpen && (
        <div className="keep-awake-panel">
          <div className="keep-awake-panel__header">
            <span className="keep-awake-panel__title">{title}</span>
            <span className="keep-awake-panel__status">{statusLabel}</span>
          </div>
          <div className="keep-awake-panel__list" role="menu" aria-label={title}>
            {KEEP_AWAKE_OPTIONS.map((opt) => {
              const selected = awakeState.mode === opt.mode;
              return (
                <div
                  key={opt.mode}
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={0}
                  className="keep-awake-panel__item"
                  onClick={() => selectMode(opt.mode)}
                  onKeyDown={(e) => onItemKeyDown(e, opt.mode)}
                >
                  <span className={`keep-awake-panel__radio${selected ? ' keep-awake-panel__radio--selected' : ''}`} />
                  <div className="keep-awake-panel__content">
                    <span className="keep-awake-panel__label">{t(opt.labelKey, opt.label)}</span>
                    <span className="keep-awake-panel__hint">{t(opt.hintKey, opt.hint)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
