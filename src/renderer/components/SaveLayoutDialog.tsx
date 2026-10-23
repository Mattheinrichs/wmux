import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';

/**
 * Name a layout preset before it is created (#329). Every "save current layout"
 * entry point — the sidebar's layout dropdown, the command palette, Settings →
 * Workspace and the workspace context menu — opens this through
 * `requestLayoutSave`, so naming behaves the same everywhere. Saving used to
 * create a "Layout N" at once and send the user to Manage layouts to rename it.
 *
 * The workspace to capture was fixed when the dialog opened (it is in
 * `pendingLayoutSave`), so a right-click on an inactive workspace saves THAT
 * workspace even if focus moves while the dialog is up. Cancel creates nothing.
 */
export default function SaveLayoutDialog() {
  const t = useT();
  const pending = useStore((s) => s.pendingLayoutSave);
  const confirmLayoutSave = useStore((s) => s.confirmLayoutSave);
  const cancelLayoutSave = useStore((s) => s.cancelLayoutSave);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Prefill and select the suggestion each time the dialog opens, so typing
  // replaces it and Enter accepts it.
  useEffect(() => {
    if (!pending) return;
    setName(pending.suggestedName);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [pending]);

  if (!pending) return null;

  const valid = name.trim().length > 0;
  const save = () => {
    if (!valid) return;
    if (!confirmLayoutSave(name)) {
      // The captured workspace closed while the dialog was up.
      window.wmux?.notification?.fire({
        surfaceId: '',
        text: t('palette.saveCurrentLayoutFailed', 'No active workspace to save as a layout.'),
        title: 'wmux',
      });
    }
  };

  return (
    <div className="confirm-dialog__overlay save-layout-dialog__overlay" onClick={cancelLayoutSave}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-layout-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') cancelLayoutSave();
          if (e.key === 'Enter') save();
        }}
      >
        <div className="confirm-dialog__title" id="save-layout-dialog-title">
          {t('layoutSave.title', 'Save layout preset')}
        </div>
        <label className="confirm-dialog__message" htmlFor="save-layout-dialog-name">
          {t('layoutSave.nameLabel', 'Preset name')}
        </label>
        <input
          ref={inputRef}
          id="save-layout-dialog-name"
          className="save-layout-dialog__input"
          value={name}
          spellCheck={false}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="confirm-dialog__actions">
          <button className="confirm-dialog__btn" onClick={cancelLayoutSave}>
            {t('confirmClose.cancel', 'Cancel')}
          </button>
          <button className="confirm-dialog__btn confirm-dialog__btn--primary" onClick={save} disabled={!valid}>
            {t('layoutSave.save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
