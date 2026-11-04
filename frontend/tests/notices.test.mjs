import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { cardActionToastTone, NOTICE } from '../lib/notices.ts'
import { resolveToastUpdate, toastDuration } from '../lib/toast-timing.ts'
import { unlinkDialogCopy } from '../lib/unlink-dialog.ts'

test('success toasts close after 1 second and errors stay for 3 seconds', () => {
  assert.equal(toastDuration('success', NOTICE.cardRegistered), 1000)
  assert.equal(toastDuration('success', NOTICE.cardUnlinked), 1000)
  assert.equal(toastDuration('success', NOTICE.paymentDone), 1000)
  assert.equal(toastDuration('error', NOTICE.cardExpired), 3000)
  assert.equal(toastDuration('error', NOTICE.paymentFailed), 3000)
  assert.equal(toastDuration('error', NOTICE.cardsLoadFailed), 3000)
})

test('short info toasts last 1 second and longer copy gets more time', () => {
  assert.equal(toastDuration('info', NOTICE.cardDuplicate), 1000)
  assert.equal(toastDuration('info', '카드를 선택해 주세요.'), 1000)
  const longMessage = '입력값을 확인해 주세요. 카드번호, 유효기간, CVC를 모두 입력한 뒤 다시 등록해 주세요.'
  const duration = toastDuration('info', longMessage)
  assert.ok(duration > 1000)
  assert.ok(duration <= 4500)
})

test('repeated notices refresh one slot instead of stacking', () => {
  const first = resolveToastUpdate(null, { tone: 'success', message: NOTICE.cardRegistered }, 1)
  const repeat = resolveToastUpdate(first, { tone: 'success', message: NOTICE.cardRegistered }, 2)
  const next = resolveToastUpdate(repeat, { tone: 'error', message: NOTICE.cardExpired }, 3)
  assert.equal(first.action, 'replace')
  assert.equal(repeat.action, 'refresh')
  assert.equal(repeat.key, first.key)
  assert.equal(repeat.revision, first.revision + 1)
  assert.equal(next.action, 'replace')
  assert.equal(next.key, 3)
  assert.notEqual(next.key, repeat.key)
})

test('duplicate card is an info notice and other card failures are errors', () => {
  assert.equal(cardActionToastTone(NOTICE.cardDuplicate), 'info')
  assert.equal(cardActionToastTone(NOTICE.cardExpired), 'error')
  assert.equal(cardActionToastTone('카드 등록에 실패했습니다.'), 'error')
})

test('sad dongi appears only when the onepass card itself is unlinked', () => {
  const onepass = unlinkDialogCopy({ onepass: true, cardName: '원패스 카드' })
  const check = unlinkDialogCopy({ onepass: false, cardName: '부산은행 체크카드' })
  const credit = unlinkDialogCopy({ onepass: false, cardName: '부산은행 신용카드' })
  assert.equal(onepass.showSadDongi, true)
  assert.equal(onepass.title, '정말 원패스 카드를 해제하시겠습니까?')
  assert.equal(check.showSadDongi, false)
  assert.equal(credit.showSadDongi, false)
  assert.equal(check.title, '이 카드의 등록을 해제하시겠습니까?')
  assert.match(check.description, /부산은행 체크카드/)
  assert.match(credit.description, /부산은행 신용카드/)
})

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'tests') continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(fullPath))
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(fullPath)
  }
  return files
}

test('frontend screens do not call browser alert or confirm', async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const pattern = /\b(?:window\.)?(?:alert|confirm)\s*\(/
  const files = await sourceFiles(root)
  assert.ok(files.length > 0)
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    assert.equal(pattern.test(source), false, file)
  }
})
