import clsx from 'clsx'
import logoUrl from '../../assets/logo.png'
import { IconPersonaOutline16 } from '../base/icons.js'
import styles from './Persona.module.css'

export const PersonaAvatar = ({
  avatar,
  name,
  isDefault = false,
  size = 'm',
  className,
}: {
  avatar?: string
  name?: string
  isDefault?: boolean
  size?: 's' | 'm' | 'l'
  className?: string
}) => {
  const isDataImage = Boolean(avatar && avatar.startsWith('data:image/'))
  const initial = name?.trim().slice(0, 1).toUpperCase() || ''

  return (
    <span
      className={clsx(
        styles.avatar,
        styles[`avatar_${size}`],
        isDefault && !isDataImage && styles.avatarBrand,
        className
      )}
      aria-hidden={!name}
    >
      {isDataImage ? (
        <img src={avatar} alt={name ?? ''} className={styles.avatarImg} />
      ) : isDefault ? (
        <img src={logoUrl} alt={name ?? 'my-whale'} className={styles.avatarLogo} />
      ) : initial ? (
        <span className={styles.avatarInitial}>{initial}</span>
      ) : (
        <IconPersonaOutline16 />
      )}
    </span>
  )
}
