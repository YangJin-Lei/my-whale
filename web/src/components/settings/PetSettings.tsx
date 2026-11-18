import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { PET_CATEGORIES, PET_CATALOG } from '../../pet/catalog.js'
import { PetSprite } from '../../pet/PetSprite.js'
import { setActivePetId, setPetEnabled, useSettings } from '../../services/settings.js'
import styles from './PetSettings.module.css'

/** 设置 → 桌宠：开关 + 分类选择（经典桌宠 / Chiikawa 系列等） */
export const PetSettings = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const petEnabled = useSettings((state) => state.petEnabled)
  const activePetId = useSettings((state) => state.activePetId)

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
        const items = PET_CATALOG.filter((item) => item.categoryId === category.id)
        if (items.length === 0) {
          return null
        }
        return (
          <div key={category.id} className={styles.categorySection}>
            <div className={styles.categoryTitle}>{category.name[locale]}</div>
            <div className={styles.grid}>
              {items.map((pet) => {
                const active = activePetId === pet.id
                return (
                  <button
                    key={pet.id}
                    type="button"
                    aria-pressed={active}
                    className={clsx(styles.card, active && styles.cardActive)}
                    onClick={() => setActivePetId(pet.id)}
                  >
                    <PetSprite
                      spriteUrl={pet.spriteUrl}
                      mood={active ? 'wave' : 'idle'}
                      width={48}
                      animate={active}
                    />
                    <span className={styles.name}>{pet.name[locale]}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
