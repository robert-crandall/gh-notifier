import { tokenizeLinks } from './linkify'
import { openExternal } from '../ipc'
import styles from './LinkifiedText.module.css'

interface LinkifiedTextProps {
  text: string
}

/**
 * Render a plain string, turning any http/https URLs into clickable links.
 *
 * Links are `<button>`s (not `<a href>`) that call `openExternal` — matching the
 * app's convention for external links and sidestepping in-window navigation.
 * `stopPropagation` keeps a click on the link from also triggering a clickable
 * ancestor (e.g. a click-to-edit region).
 */
export function LinkifiedText({ text }: LinkifiedTextProps): JSX.Element {
  const tokens = tokenizeLinks(text)
  return (
    <>
      {tokens.map((token) =>
        token.kind === 'url' ? (
          <button
            key={`u-${token.start}`}
            type="button"
            className={styles.link}
            title={token.value}
            onClick={(e) => {
              e.stopPropagation()
              openExternal(token.value)
            }}
          >
            {token.value}
          </button>
        ) : (
          <span key={`t-${token.start}`}>{token.value}</span>
        )
      )}
    </>
  )
}
