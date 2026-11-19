import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { DEFAULT_PET_ID, PET_CATEGORIES, usePetCatalog } from '../../pet/catalog.js'
import { deleteCustomPet, importCustomPetFiles } from '../../pet/customPets.js'
import { PetSprite } from '../../pet/PetSprite.js'
import { setActivePetId, setPetEnabled, useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import styles from './PetSettings.module.css'

/** 设置 → 桌宠：开关 + 三大系列选择 + 本地 JSON/图片自定义上传 */
export const PetSettings = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const petEnabled = useSettings((state) => state.petEnabled)
  const activePetId = useSettings((state) => state.activePetId)
  const allPets = usePetCatalog()
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

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
                const active = activePetId === pet.id
                return (
                  <div key={pet.id} className={styles.cardWrap}>
                    <button
                      type="button"
                      aria-pressed={active}
                      className={clsx(styles.card, active && styles.cardActive)}
                      onClick={() => setActivePetId(pet.id)}
                    >
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
                          if (activePetId === pet.id) {
                            setActivePetId(DEFAULT_PET_ID)
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
