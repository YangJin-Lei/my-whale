import clsx from 'clsx'
import { Capacitor } from '@capacitor/core'
import { useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { extractSessionNow, selectSession, useChatStore } from '../../services/chat/store.js'
import { exportBlobFile } from '../../services/fileExport.js'
import { hasSensitiveInfo } from '../../services/memory/sensitive.js'
import {
  addMemory,
  clearAllMemories,
  deleteMemory,
  undoClearMemories,
  updateMemory,
  useMemoryStore,
} from '../../services/memory/store.js'
import {
  MEMORY_CONTENT_MAX,
  type Memory,
  type MemoryCategory,
} from '../../services/memory/types.js'
import { PROFILE_MAX } from '../../services/persona/types.js'
import {
  applyProfileBackup,
  buildProfileBackup,
  parseProfileBackup,
  type ProfileBackupV1,
} from '../../services/profileBackup.js'
import {
  setMemoryAuto,
  setMemoryEnabled,
  setProfile,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import {
  IconDownloadOutline16,
  IconEditOutline16,
  IconPauseOutline16,
  IconPinOutline16,
  IconPlayMediaOutline16,
  IconRightUpOutline14,
  IconTrashOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { closeSettings } from '../settings/settingsDialogState.js'
import styles from './Memory.module.css'

export const MemorySettings = () => {
  const t = useTranslate()
  const memoryEnabled = useSettings((state) => state.memoryEnabled)
  const memoryAuto = useSettings((state) => state.memoryAuto)
  const profile = useSettings((state) => state.profile)
  const memories = useMemoryStore((state) => state.memories)
  const undoSnapshot = useMemoryStore((state) => state.undoSnapshot)
  const activeId = useChatStore((state) => state.activeId)
  const activeSession = useChatStore((state) =>
    state.activeId ? state.sessionCache[state.activeId] : undefined
  )

  const [extracting, setExtracting] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'all' | MemoryCategory>('all')
  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryCategory>('preference')
  const [sensitivePending, setSensitivePending] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingProfileImport, setPendingProfileImport] = useState<ProfileBackupV1 | null>(null)
  const profileFileRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return memories
      .filter((item) => (category === 'all' ? true : item.category === category))
      .filter((item) => (!keyword ? true : item.content.toLowerCase().includes(keyword)))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1
        }
        return b.updatedAt - a.updatedAt
      })
  }, [memories, category, search])

  const categoryOptions: { value: 'all' | MemoryCategory; label: string }[] = [
    { value: 'all', label: t('memoryCategoryAll') },
    { value: 'profile', label: t('memoryCategoryProfile') },
    { value: 'preference', label: t('memoryCategoryPreference') },
    { value: 'project', label: t('memoryCategoryProject') },
    { value: 'other', label: t('memoryCategoryOther') },
  ]

  const commitAdd = async (bypassSensitive = false) => {
    const clean = newContent.trim()
    if (!clean) {
      return
    }
    if (!bypassSensitive && hasSensitiveInfo(clean)) {
      setSensitivePending(true)
      return
    }
    await addMemory({ content: clean, category: newCategory, source: 'manual' })
    setNewContent('')
    setAdding(false)
    setSensitivePending(false)
  }

  const commitEdit = async (item: Memory) => {
    const clean = editContent.trim()
    setEditingId(null)
    if (clean && clean !== item.content) {
      await updateMemory(item.id, { content: clean })
    }
  }

  const exportProfile = async () => {
    const backup = buildProfileBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    await exportBlobFile(`my-whale-profile-${new Date().toISOString().slice(0, 10)}.json`, blob)
  }

  const handleSelectProfileFile = async (file: File) => {
    try {
      const parsed = await parseProfileBackup(file)
      setPendingProfileImport(parsed)
    } catch {
      showToast({ key: 'profileImportFailed', type: 'error' })
    }
  }

  const commitProfileImport = async (mode: 'merge' | 'replace') => {
    const backup = pendingProfileImport
    if (!backup) {
      return
    }
    setPendingProfileImport(null)
    await applyProfileBackup(backup, mode)
    showToast({ key: 'profileImportedToast' })
  }

  const handleExtractNow = async () => {
    if (!activeId || extracting) {
      return
    }
    setExtracting(true)
    try {
      const count = await extractSessionNow(activeId)
      if (count > 0) {
        showToast({ key: 'memoryAutoSavedToast', params: { count } })
      } else {
        showToast({ key: 'memoryExtractNoneToast' })
      }
    } catch {
      showToast({ key: 'memoryExtractFailedToast', type: 'error' })
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toggleRow}>
        <div>
          <div className={styles.label}>{t('memoryEnabledLabel')}</div>
        </div>
        <input
          type="checkbox"
          checked={memoryEnabled}
          onChange={(event) => setMemoryEnabled(event.target.checked)}
        />
      </div>

      <div className={styles.toggleRow}>
        <div>
          <div className={styles.label}>{t('memoryAutoLabel')}</div>
        </div>
        <input
          type="checkbox"
          disabled={!memoryEnabled}
          checked={memoryEnabled && memoryAuto}
          onChange={(event) => setMemoryAuto(event.target.checked)}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.fieldHeader}>
          <label className={styles.label}>{t('memoryAboutMe')}</label>
          <span className={styles.counter}>
            {profile.length}/{PROFILE_MAX}
          </span>
        </div>
        <textarea
          className={styles.textarea}
          rows={3}
          maxLength={PROFILE_MAX}
          placeholder={t('memoryAboutMePlaceholder')}
          value={profile}
          onChange={(event) => setProfile(event.target.value)}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            placeholder={t('memorySearchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            ariaLabel={t('memoryCategoryAll')}
            value={category}
            options={categoryOptions}
            onChange={(value) => setCategory(value)}
          />
          <Button variant="primary" size="s" onClick={() => setAdding((v) => !v)}>
            + {t('memoryAdd')}
          </Button>
          {activeId && activeSession && !activeSession.persona?.incognito ? (
            <Button
              variant="outlined"
              size="s"
              disabled={extracting}
              onClick={() => void handleExtractNow()}
            >
              {extracting ? t('memoryExtracting') : t('memoryExtractNow')}
            </Button>
          ) : null}
        </div>

        {adding ? (
          <div className={styles.addBox}>
            <textarea
              className={styles.textarea}
              rows={2}
              maxLength={MEMORY_CONTENT_MAX}
              placeholder={t('memoryAddPlaceholder')}
              value={newContent}
              onChange={(event) => {
                setNewContent(event.target.value)
                setSensitivePending(false)
              }}
            />
            <div className={styles.addActions}>
              <Select
                ariaLabel={t('memoryCategoryAll')}
                value={newCategory}
                options={categoryOptions.filter(
                  (opt): opt is { value: MemoryCategory; label: string } => opt.value !== 'all'
                )}
                onChange={(value) => setNewCategory(value)}
              />
              <div className={styles.addBtns}>
                <Button
                  variant="outlined"
                  size="s"
                  onClick={() => {
                    setAdding(false)
                    setSensitivePending(false)
                  }}
                >
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="s"
                  disabled={!newContent.trim()}
                  onClick={() => void commitAdd(false)}
                >
                  {t('personaSave')}
                </Button>
              </div>
            </div>
            {sensitivePending ? (
              <div className={styles.sensitiveBar}>
                <span>{t('memorySensitiveWarn')}</span>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => void commitAdd(true)}
                >
                  {t('memoryConfirmSave')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {undoSnapshot ? (
          <div className={styles.undoBar}>
            <span>{t('memoryClearedUndo')}</span>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => void undoClearMemories()}
            >
              {t('memoryUndo')}
            </button>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className={styles.empty}>{t('memoryEmpty')}</div>
        ) : (
          <div className={styles.list}>
            {filtered.map((item) => (
              <div
                key={item.id}
                className={clsx(styles.item, !item.enabled && styles.itemDisabled)}
              >
                <button
                  type="button"
                  className={clsx(styles.iconBtn, item.pinned && styles.iconBtnActive)}
                  title={item.pinned ? t('memoryUnpin') : t('memoryPin')}
                  aria-label={item.pinned ? t('memoryUnpin') : t('memoryPin')}
                  onClick={() => void updateMemory(item.id, { pinned: !item.pinned })}
                >
                  <IconPinOutline16 />
                </button>
                <div className={styles.itemBody}>
                  {editingId === item.id ? (
                    <input
                      className={styles.inlineEdit}
                      autoFocus
                      maxLength={MEMORY_CONTENT_MAX}
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
                      onBlur={() => void commitEdit(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          void commitEdit(item)
                        } else if (event.key === 'Escape') {
                          setEditingId(null)
                        }
                      }}
                    />
                  ) : (
                    <div className={styles.itemText}>
                      {item.content}
                      {!item.enabled ? (
                        <span className={styles.disabledTag}>({t('memoryDisabledTag')})</span>
                      ) : null}
                    </div>
                  )}
                </div>
                <div className={styles.itemActions}>
                  {item.sourceSessionId ? (
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title={t('memoryJumpSession')}
                      aria-label={t('memoryJumpSession')}
                      onClick={() => {
                        const sid = item.sourceSessionId
                        if (sid) {
                          closeSettings()
                          selectSession(sid)
                        }
                      }}
                    >
                      <IconRightUpOutline14 />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={t('editMessage')}
                    aria-label={t('editMessage')}
                    onClick={() => {
                      setEditingId(item.id)
                      setEditContent(item.content)
                    }}
                  >
                    <IconEditOutline16 />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={item.enabled ? t('memoryDisable') : t('memoryEnable')}
                    aria-label={item.enabled ? t('memoryDisable') : t('memoryEnable')}
                    onClick={() => void updateMemory(item.id, { enabled: !item.enabled })}
                  >
                    {item.enabled ? <IconPauseOutline16 /> : <IconPlayMediaOutline16 />}
                  </button>
                  <button
                    type="button"
                    className={clsx(styles.iconBtn, styles.dangerText)}
                    title={t('delete')}
                    aria-label={t('delete')}
                    onClick={() => void deleteMemory(item.id)}
                  >
                    <IconTrashOutline16 />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footerRow}>
        <div className={styles.profileBackupBtns}>
          <Button variant="outlined" size="s" onClick={() => void exportProfile()}>
            <IconDownloadOutline16 />
            {t('profileExport')}
          </Button>
          <Button variant="outlined" size="s" onClick={() => profileFileRef.current?.click()}>
            <IconUploadOutline14 />
            {t('profileImport')}
          </Button>
          <input
            ref={profileFileRef}
            type="file"
            accept={Capacitor.isNativePlatform() ? '*/*' : '.json,application/json'}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void handleSelectProfileFile(file)
              }
            }}
          />
        </div>
        {memories.length > 0 ? (
          <Button variant="dangerOutlined" size="s" onClick={() => setConfirmClear(true)}>
            {t('memoryClearAll')}
          </Button>
        ) : null}
      </div>

      {confirmClear ? (
        <Modal
          title={t('memoryClearConfirmTitle')}
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setConfirmClear(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="m"
                onClick={() => {
                  setConfirmClear(false)
                  void clearAllMemories()
                }}
              >
                {t('memoryClearAll')}
              </Button>
            </>
          }
        >
          {t('memoryClearConfirmDesc')}
        </Modal>
      ) : null}

      {pendingProfileImport ? (
        <Modal
          title={t('profileImportModeTitle')}
          closable
          onClose={() => setPendingProfileImport(null)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => void commitProfileImport('merge')}>
                {t('profileImportMerge')}
              </Button>
              <Button
                variant="dangerOutlined"
                size="m"
                onClick={() => void commitProfileImport('replace')}
              >
                {t('profileImportReplace')}
              </Button>
            </>
          }
        >
          {t('profileImportModeDesc', {
            personas: pendingProfileImport.personas.length,
            memories: pendingProfileImport.memories.length,
          })}
        </Modal>
      ) : null}
    </div>
  )
}
