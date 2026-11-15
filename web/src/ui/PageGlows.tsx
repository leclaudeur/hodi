import styles from './PageGlows.module.css'

// Behind a full-page step (the setup, Connexion, J'ai un code), as on the landing page: five soft blurs of the
// theme's colours, each on its own slow path. Its page composes `host` from the same file.
const PageGlows = () => (
  <div className={styles.glows} aria-hidden="true">
    <i />
    <i />
    <i />
    <i />
    <i />
  </div>
)

export default PageGlows
