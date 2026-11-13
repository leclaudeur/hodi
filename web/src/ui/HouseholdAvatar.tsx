import styles from './HouseholdAvatar.module.css'

interface HouseholdAvatarProps {
  name: string
  // Its address (/api/households/<id>/photo?v=…, or a plugin's household.photo); null: its initial.
  photo: string | null
  // Its whole width, ring included.
  size: number
  // A photo picked but not sent yet.
  preview?: string | null
}

// A household's photo or its initial, round as a profile's in « Qui lit ? »: Réglages › Foyer, Serveur › Foyers, a
// plugin's « Quel foyer ? ».
const HouseholdAvatar = ({ name, photo, size, preview }: HouseholdAvatarProps) => {
  const shown = preview === undefined ? photo : preview
  return (
    <span className={styles.avatar} style={{ width: size, height: size }} aria-hidden="true">
      <span className={styles.face} style={{ fontSize: Math.round(size * 0.38) }}>
        {shown ? (
          <img src={shown} alt="" width={size} height={size} />
        ) : (
          <span className={styles.initial}>{(name.trim()[0] ?? '?').toUpperCase()}</span>
        )}
      </span>
    </span>
  )
}

export default HouseholdAvatar
