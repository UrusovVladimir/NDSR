// Закрытие модальных окон кликом вне окна (по затемнению) — для всех Dialog.
//
// Стандартный dismissableMask PrimeVue закрывает по событию click, а click
// приходит на затемнение и тогда, когда кнопку нажали ВНУТРИ окна, а
// отпустили снаружи (выделяли текст для копирования и «вылезли» за край).
// Здесь окно закрывается, только если и нажатие, и отпускание мыши были на
// самом затемнении. Закрытие — нажатием крестика окна: окна без крестика
// (прогресс операции, обязательное подтверждение, «занято» —
// :closable="false") так не закрываются, а все обработчики закрытия
// (сброс состояния, отмена) срабатывают как при обычном закрытии.
// Своё dismissableMask у Dialog не включать — оно закрывало бы и при выделении.
const MASK = 'p-dialog-mask'

export function installDialogOutsideClose() {
  let pressedMask = null

  document.addEventListener('mousedown', (e) => {
    pressedMask = e.button === 0 && e.target?.classList?.contains(MASK) ? e.target : null
  }, true)

  document.addEventListener('click', (e) => {
    const mask = e.target
    const startedOnMask = pressedMask === mask
    pressedMask = null
    if (!startedOnMask || !mask?.classList?.contains(MASK)) return
    const closeBtn = mask.querySelector('.p-dialog-header-close')
    if (closeBtn && !closeBtn.disabled) closeBtn.click()
  }, true)
}
