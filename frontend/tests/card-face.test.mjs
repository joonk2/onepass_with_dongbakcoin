import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { cardKindLabel, registrationStatusLabel, resolveRegisteredCardFace } from '../lib/card-face.ts'
import { cardDesignStorageKey, ONEPASS_CARD_IMAGES } from '../lib/dongi/card-design.ts'

test('같은 원패스 상품이라도 선택한 디자인 이미지가 다르다', () => {
  const classic = resolveRegisteredCardFace({
    productId: 'PRD_DB_SYN',
    onepass: true,
    onepassDesignId: 'classic',
  })
  const rope = resolveRegisteredCardFace({
    productId: 'PRD_DB_SYN',
    onepass: true,
    onepassDesignId: 'rope',
  })
  const big = resolveRegisteredCardFace({
    productId: 'PRD_DB_SYN',
    onepass: true,
    onepassDesignId: 'big',
  })
  assert.equal(classic.kind, 'image')
  assert.equal(rope.kind, 'image')
  assert.equal(big.kind, 'image')
  assert.equal(classic.designId, 'classic')
  assert.equal(classic.productId, 'PRD_DB_SYN')
  assert.equal(classic.imagePath, '/dongi-classic.png')
  assert.notEqual(classic.imagePath, rope.imagePath)
  assert.notEqual(classic.imagePath, big.imagePath)
  assert.ok(classic.height > classic.width)
  assert.ok(rope.height > rope.width)
  assert.ok(big.width > big.height)
  assert.equal(big.imagePath, ONEPASS_CARD_IMAGES.big.src)
  for (const image of Object.values(ONEPASS_CARD_IMAGES)) {
    assert.equal(existsSync(fileURLToPath(new URL(`../public${image.src}`, import.meta.url))), true, image.src)
  }
})

test('부산은행 카드는 상품별 플레이트를 쓰고 원패스 이미지로 대체하지 않는다', () => {
  const ids = ['BNK_CK_P19', 'BNK_CK_P23', 'BNK_CR_P07', 'BNK_CR_P09', 'BNK_CR_P10', 'BNK_CR_P16']
  const faces = ids.map((productId) => resolveRegisteredCardFace({
    productId,
    onepass: false,
    onepassDesignId: 'rope',
  }))
  assert.ok(faces.every((face) => face.kind === 'plate'))
  assert.equal(new Set(faces.map((face) => face.designId)).size, ids.length)
  const bbang = faces[0]
  assert.equal(bbang.productId, 'BNK_CK_P19')
  assert.equal(bbang.designId, 'bbang')
  assert.equal('imagePath' in bbang, false)
})

test('디자인 이미지가 없으면 다른 카드 이미지로 대체하지 않는다', () => {
  const unknownProduct = resolveRegisteredCardFace({
    productId: 'BNK_UNKNOWN',
    onepass: false,
    onepassDesignId: null,
  })
  const unknownDesign = resolveRegisteredCardFace({
    productId: 'PRD_DB_SYN',
    onepass: true,
    onepassDesignId: 'nope',
  })
  assert.equal(unknownProduct.kind, 'missing')
  assert.equal(unknownDesign.kind, 'missing')
  assert.equal('imagePath' in unknownProduct, false)
  assert.equal('imagePath' in unknownDesign, false)
})

test('디자인 저장 키는 사용자마다 다르다', () => {
  const bridge = cardDesignStorageKey('kb_bridge')
  const other = cardDesignStorageKey('other_user')
  assert.notEqual(bridge, other)
  assert.match(bridge, /kb_bridge/)
  assert.match(other, /other_user/)
})

test('카드 종류와 등록 상태 문구', () => {
  assert.equal(cardKindLabel({ onepass: true, cardType: 'DONGBAEK_CHECK' }), '원패스 카드')
  assert.equal(cardKindLabel({ onepass: false, cardType: 'BANK_CHECK' }), '체크카드')
  assert.equal(cardKindLabel({ onepass: false, cardType: 'BANK_CREDIT' }), '신용카드')
  assert.equal(cardKindLabel({ onepass: false, cardType: null }), '카드 종류 확인 불가')
  assert.equal(registrationStatusLabel('ACTIVE'), '등록됨')
  assert.equal(registrationStatusLabel('INACTIVE'), '등록 해제')
})
