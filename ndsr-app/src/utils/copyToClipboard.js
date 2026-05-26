export const copyToClipboard = async (text) => {
  if (!text) return false

  try {
    // Modern API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }

    // Fallback
    const textArea = document.createElement('textarea')
    textArea.value = text

    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    textArea.style.top = '-999999px'

    document.body.appendChild(textArea)

    textArea.focus()
    textArea.select()

    const success = document.execCommand('copy')

    textArea.remove()

    return success
  } catch (error) {
    console.error('Clipboard copy failed:', error)
    return false
  }
}