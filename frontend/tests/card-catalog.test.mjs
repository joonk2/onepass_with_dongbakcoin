import assert from 'node:assert/strict'
import test from 'node:test'
import { cardArtOf, cardKindOf, groupByIssuer, issuerLabel, productPlate, productsOfKind, registrableProducts } from '../lib/card-catalog.ts'

test('only the 6 allowed BNK products are registrable', () => {
  const ids = ['BNK_CK_P19', 'BNK_CK_P23', 'BNK_CR_P07', 'BNK_CR_P09', 'BNK_CR_P10', 'BNK_CR_P16']
  const input = [...ids, 'PRD_DB_SYN', 'PRD_LOCAL_CR3', 'OLD_CARD'].map((product_id) => ({ product_id }))
  assert.deepEqual(registrableProducts(input).map((p) => p.product_id), ids)
})

test('selection uses only API rows for the 6 BNK ids and keeps TEST_ONLY names', () => {
  const api = [
    { product_id: 'PRD_LOCAL_CR3', product_name: 'Local Test Credit C', issuer: 'SHINHAN', card_type: 'BANK_CREDIT', product_status: 'ACTIVE' },
    { product_id: 'BNK_CK_P19', product_name: '빵빵 체크카드', issuer: 'BNK_BUSAN', card_type: 'BANK_CHECK', product_status: 'TEST_ONLY' },
    { product_id: 'BNK_CK_P23', product_name: '어디로든 그린체크카드', issuer: 'BNK_BUSAN', card_type: 'BANK_CHECK', product_status: 'TEST_ONLY' },
    { product_id: 'BNK_CR_P07', product_name: 'Ding Ding♪ 신용카드 (딩딩 신용카드)', issuer: 'BNK_BUSAN', card_type: 'BANK_CREDIT', product_status: 'TEST_ONLY' },
    { product_id: 'BNK_CR_P09', product_name: '팟(pod)카드', issuer: 'BNK_BUSAN', card_type: 'BANK_CREDIT', product_status: 'TEST_ONLY' },
    { product_id: 'BNK_CR_P10', product_name: 'SK OIL&LPG카드', issuer: 'BNK_BUSAN', card_type: 'BANK_CREDIT', product_status: 'TEST_ONLY' },
    { product_id: 'BNK_CR_P16', product_name: 'ZipL 신용카드', issuer: 'BNK_BUSAN', card_type: 'BANK_CREDIT', product_status: 'TEST_ONLY' },
  ]
  const choices = registrableProducts(api)
  assert.deepEqual(choices.map((product) => product.product_id), [
    'BNK_CK_P19', 'BNK_CK_P23', 'BNK_CR_P07', 'BNK_CR_P09', 'BNK_CR_P10', 'BNK_CR_P16',
  ])
  assert.equal(choices.find((product) => product.product_id === 'BNK_CK_P19').product_name, '빵빵 체크카드')
  assert.equal(choices.find((product) => product.product_id === 'BNK_CK_P19').product_status, 'TEST_ONLY')
  assert.equal(productsOfKind(choices, 'CHECK').length, 2)
  assert.equal(productsOfKind(choices, 'CREDIT').length, 4)
})

test('card art is stable per product and varies across products', () => {
  assert.deepEqual(cardArtOf('PRD_A'), cardArtOf('PRD_A'))
  const ids = ['PRD_ISS_SHINHAN_CR_01', 'PRD_ISS_SHINHAN_CR_02', 'PRD_ISS_SHINHAN_CK_01', 'PRD_ISS_SAMSUNG_CR_01', 'PRD_ISS_HYUNDAI_CR_01']
  const looks = new Set(ids.map((id) => JSON.stringify(cardArtOf(id))))
  assert.ok(looks.size >= 3)
})

const product = (id, issuer, type) => ({
  product_id: id,
  product_name: id,
  issuer,
  card_type: type,
})

const catalog = [
  product('CR1', 'BNK_BUSAN', 'BANK_CREDIT'),
  product('CR2', 'BNK_BUSAN', 'BANK_CREDIT'),
  product('CK1', 'BNK_BUSAN', 'BANK_CHECK'),
  product('DB', 'DONGBAEKJEON', 'DONGBAEK_CHECK'),
  product('UNK', null, null),
]

test('card kind is derived from card_type and ONEPASS cards are excluded', () => {
  assert.equal(cardKindOf(catalog[0]), 'CREDIT')
  assert.equal(cardKindOf(catalog[2]), 'CHECK')
  assert.equal(cardKindOf(catalog[3]), null)
  assert.equal(cardKindOf(catalog[4]), null)
})

test('products are filtered by kind and grouped by issuer', () => {
  const credit = productsOfKind(catalog, 'CREDIT')
  assert.deepEqual(credit.map((item) => item.product_id), ['CR1', 'CR2'])
  const groups = groupByIssuer(credit)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, 'BNK부산은행')
  assert.equal(groups[0].products.length, 2)
  assert.deepEqual(groupByIssuer([]), [])
})

test('NeonDB composition: 2 check + 4 credit under BNK_BUSAN, dongbaek product excluded', () => {
  const rows = [
    ['BNK_CK_P19', 'BANK_CHECK'], ['BNK_CK_P23', 'BANK_CHECK'],
    ['BNK_CR_P07', 'BANK_CREDIT'], ['BNK_CR_P09', 'BANK_CREDIT'],
    ['BNK_CR_P10', 'BANK_CREDIT'], ['BNK_CR_P16', 'BANK_CREDIT'],
    ['PRD_DB_SYN', 'DONGBAEK_CHECK'],
  ].map(([product_id, card_type]) => ({
    product_id,
    product_name: product_id,
    card_type,
    issuer: card_type.startsWith('DONGBAEK') ? 'DONGBAEKJEON' : 'BNK_BUSAN',
  }))
  assert.equal(productsOfKind(rows, 'CHECK').length, 2)
  assert.equal(productsOfKind(rows, 'CREDIT').length, 4)
  const groups = groupByIssuer([...productsOfKind(rows, 'CHECK'), ...productsOfKind(rows, 'CREDIT')])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].products.length, 6)
})

test('the six Busan plates are distinct and not the shared red issuer theme', () => {
  const ids = ['BNK_CK_P19', 'BNK_CK_P23', 'BNK_CR_P07', 'BNK_CR_P09', 'BNK_CR_P10', 'BNK_CR_P16']
  const plates = ids.map((id) => productPlate(id))
  assert.ok(plates.every((plate) => plate))
  assert.equal(new Set(plates.map((plate) => plate.plate)).size, 6)
  assert.equal(new Set(plates.map((plate) => plate.background)).size, 6)
  assert.ok(plates.every((plate) => !plate.background.includes('#c92e48')))
  assert.equal(productPlate('PRD_LOCAL_CR3'), null)
})

test('unknown issuers are not invented', () => {
  assert.equal(issuerLabel(null), '카드사 정보 없음')
  assert.equal(issuerLabel('OTHER_BANK'), 'OTHER_BANK')
})
