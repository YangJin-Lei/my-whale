import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { DEFAULT_PET_ID, findPetById, PET_CATEGORIES, usePetCatalog } from '../../pet/catalog.js'
import {
  openPetChatroom,
  removeDesktopPetWithMemory,
  toggleDesktopPetWithMemory,
} from '../../pet/chatroom.js'
import { deleteCustomPet, importCustomPetFiles } from '../../pet/customPets.js'
import { PetSprite } from '../../pet/PetSprite.js'
import {
  clampPetSize,
  getMaxPetWidth,
  PET_MAX_DESKTOP,
  PET_SIZE_MIN,
  setActivePetId,
  setPetEnabled,
  setPetSize,
  useSettings,
} from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import { closeSettings } from './settingsDialogState.js'
import styles from './PetSettings.module.css'

/** 设置 → 桌宠：开关 + 大小滑块 + 多桌宠展示槽位 + 群聊室入口 + 全系列宠物库 */
export const PetSettings = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const petEnabled = useSettings((state) => state.petEnabled)
  const desktopPetIds = useSettings((state) => state.desktopPetIds)
  const petSize = useSettings((state) => state.petSize)
  const allPets = usePetCatalog()
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [viewportW, setViewportW] = useState(() =>
    typeof window === 'undefined' ? 390 : window.innerWidth
  )

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const maxPetW = getMaxPetWidth(viewportW)
  const effectiveSize = clampPetSize(petSize, viewportW)

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) {
      return
    }
    setUploading(true)
    try {
      const record = await importCustomPetFiles(Array.from(fileList))
      setActivePetId(record.id)
      showToast({ key: 'petUploadSuccess', params: { name: record.name } })
    } catch {
      showToast({ key: 'petUploadFailed', type: 'error' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <label className={styles.toggleRow}>
        <span className={styles.toggleLabel}>{t('settingsPet')}</span>
        <input
          type="checkbox"
          aria-label={t('settingsPet')}
          checked={petEnabled}
          onChange={(event) => setPetEnabled(event.target.checked)}
        />
      </label>

      <div className={styles.controlCard}>
        <div className={styles.controlTop}>
          <span className={styles.toggleLabel}>
            {t('petSizeLabel')} ({effectiveSize}px)
          </span>
          <div className={styles.sizePresetGroup}>
            <button
              type="button"
              className={styles.uploadBtn}
              onClick={() => setPetSize(PET_SIZE_MIN)}
            >
              {t('petSizeMin')}
            </button>
            <button type="button" className={styles.uploadBtn} onClick={() => setPetSize(72)}>
              {t('petSizeDefault')}
            </button>
            <button type="button" className={styles.uploadBtn} onClick={() => setPetSize(maxPetW)}>
              {t('petSizeHalf')}
            </button>
          </div>
        </div>
        <input
          type="range"
          min={PET_SIZE_MIN}
          max={maxPetW}
          step={2}
          aria-label={t('petSizeLabel')}
          className={styles.sizeSlider}
          value={effectiveSize}
          onChange={(event) => setPetSize(Number(event.target.value))}
        />
      </div>

      <div className={styles.controlCard}>
        <div className={styles.controlTop}>
          <span className={styles.toggleLabel}>
            {t('petDesktopSlots', { count: desktopPetIds.length, max: PET_MAX_DESKTOP })}
          </span>
          <button
            type="button"
            className={styles.uploadBtn}
            onClick={() => {
              closeSettings()
              openPetChatroom()
            }}
          >
            {t('petRoomOpenBtn')}
          </button>
        </div>
        <div className={styles.slotList}>
          {desktopPetIds.map((id) => {
            const pet = findPetById(id)
            return (
              <div key={id} className={styles.slotChip}>
                <PetSprite
                  spriteUrl={pet.spriteUrl}
                  mood="idle"
                  width={26}
                  cols={pet.cols}
                  rows={pet.rows}
                  animate={false}
                />
                <span className={styles.slotName}>{pet.name[locale]}</span>
                {desktopPetIds.length > 1 ? (
                  <button
                    type="button"
                    className={styles.slotRemoveBtn}
                    aria-label={t('delete')}
                    onClick={() => removeDesktopPetWithMemory(id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {PET_CATEGORIES.map((category) => {
        const items = allPets.filter((item) => item.categoryId === category.id)
        if (items.length === 0 && category.id !== 'library') {
          return null
        }
        return (
          <div key={category.id} className={styles.categorySection}>
            <div className={styles.categoryHeader}>
              <span className={styles.categoryTitle}>{category.name[locale]}</span>
              {category.id === 'library' ? (
                <>
                  <button
                    type="button"
                    className={styles.uploadBtn}
                    disabled={uploading}
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    + {t('petUploadCustom')}
                  </button>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    accept="image/*,.json,application/json"
                    hidden
                    onChange={(event) => {
                      const files = event.target.files
                      void handleUploadFiles(files)
                      event.target.value = ''
                    }}
                  />
                </>
              ) : null}
            </div>
            <div className={styles.grid}>
              {items.map((pet) => {
                const slotIdx = desktopPetIds.indexOf(pet.id)
                const active = slotIdx !== -1
                return (
                  <div key={pet.id} className={styles.cardWrap}>
                    <button
                      type="button"
                      aria-pressed={active}
                      className={clsx(styles.card, active && styles.cardActive)}
                      onClick={() => {
                        const outcome = toggleDesktopPetWithMemory(pet.id)
                        if (outcome === 'full') {
                          showToast({
                            key: 'petDesktopMaxToast',
                            params: { max: PET_MAX_DESKTOP },
                          })
                        }
                      }}
                    >
                      {active ? <span className={styles.slotBadge}>{slotIdx + 1}</span> : null}
                      <PetSprite
                        spriteUrl={pet.spriteUrl}
                        mood={active ? 'wave' : 'idle'}
                        width={48}
                        cols={pet.cols}
                        rows={pet.rows}
                        animate={active}
                      />
                      <span className={styles.name}>{pet.name[locale]}</span>
                    </button>
                    {pet.custom ? (
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        aria-label={t('delete')}
                        onClick={() => {
                          if (desktopPetIds.includes(pet.id)) {
                            const remaining = desktopPetIds.filter((id) => id !== pet.id)
                            setActivePetId(remaining[0] ?? DEFAULT_PET_ID)
                          }
                          void deleteCustomPet(pet.id)
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
