import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { addSessionLocalMemory, useChatStore } from '../../services/chat/store.js'
import { hasSensitiveInfo } from '../../services/memory/sensitive.js'
import { addMemory } from '../../services/memory/store.js'
import { MEMORY_CONTENT_MAX, type MemoryCategory } from '../../services/memory/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Memory.module.css'

export const RememberAction = ({ sessionId, text }: { sessionId: string; text: string }) => {
  const t = useTranslate()
  const incognito = useChatStore((state) =>
    Boolean(state.sessionCache[sessionId]?.persona?.incognito)
  )
  const sessionMemoryScope = useChatStore(
    (state) => state.sessionCache[sessionId]?.persona?.memoryScope ?? 'global_and_local'
  )
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [target, setTarget] = useState<'global' | 'local'>('global')
  const [category, setCategory] = useState<MemoryCategory>('preference')
  const [sensitiveWarn, setSensitiveWarn] = useState(false)

  if (incognito || !text.trim()) {
    return null
  }

  const openModal = () => {
    setDraft(text.trim().slice(0, MEMORY_CONTENT_MAX))
    setTarget(sessionMemoryScope === 'local_only' ? 'local' : 'global')
    setCategory('preference')
    setSensitiveWarn(false)
    setOpen(true)
  }

  const save = async (bypassSensitive = false) => {
    const clean = draft.trim()
    if (!clean) {
      return
    }
    if (!bypassSensitive && hasSensitiveInfo(clean)) {
      setSensitiveWarn(true)
      return
    }
    if (target === 'local') {
      addSessionLocalMemory(sessionId, clean)
    } else {
      await addMemory({
        content: clean,
        category,
        source: 'manual',
        sourceSessionId: sessionId,
      })
    }
    setOpen(false)
    showToast({ key: 'memorySavedToast' })
  }

  return (
    <>
      <button type="button" className={styles.rememberBtn} onClick={openModal}>
        {t('memoryRememberAction')}
      </button>
      {open ? (
        <Modal
          title={t('memoryRememberTitle')}
          closable
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                disabled={!draft.trim()}
                onClick={() => void save(false)}
              >
                {t('personaSave')}
              </Button>
            </>
          }
        >
          <div className={styles.rememberModalBody}>
            <textarea
              className={styles.textarea}
              rows={3}
              maxLength={MEMORY_CONTENT_MAX}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                setSensitiveWarn(false)
              }}
            />
            <Select
              ariaLabel={t('memoryScopeLabel')}
              value={target}
              options={[
                { value: 'global', label: t('memoryScopeGlobalTag') },
                { value: 'local', label: t('memoryScopeLocalTag') },
              ]}
              onChange={(value) => setTarget(value)}
            />
            {target === 'global' ? (
              <Select
                ariaLabel={t('memoryCategoryAll')}
                value={category}
                options={[
                  { value: 'profile', label: t('memoryCategoryProfile') },
                  { value: 'preference', label: t('memoryCategoryPreference') },
                  { value: 'project', label: t('memoryCategoryProject') },
                  { value: 'other', label: t('memoryCategoryOther') },
                ]}
                onChange={(value) => setCategory(value)}
              />
            ) : null}
            {sensitiveWarn ? (
              <div className={styles.sensitiveBar}>
                <span>{t('memorySensitiveWarn')}</span>
                <button type="button" className={styles.linkBtn} onClick={() => void save(true)}>
                  {t('memoryConfirmSave')}
                </button>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
