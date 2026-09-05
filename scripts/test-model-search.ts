import assert from 'node:assert/strict'
import { allModels, type ModelDef } from '../src/models/registry'
import { matchesModelSearch } from '../src/models/search'

const models = allModels()
const search = (query: string) => models.filter((model) => matchesModelSearch(model, query))
const ids = (query: string) => search(query).map((model) => model.id).sort()

assert.deepEqual(ids('沙发'), ids('sofa'))
assert.deepEqual(ids('沙发'), ids('COUCH'))
assert.ok(search('沙发').length >= 7)
for (const query of ['床', '椅子', '餐桌', '书桌', '柜子', '灯', '地毯', '落地灯', '台灯', '床头柜']) {
  assert.ok(search(query).length > 0, `Expected results for ${query}`)
}
assert.deepEqual(ids('地毯'), ids('carpet'))
assert.deepEqual(ids(' Kenney   沙发 '), search('沙发').filter((m) => m.brand === 'KENNEY').map((m) => m.id).sort())
assert.ok(search('kitchen table').length > 0)
assert.ok(search('kitchen table').every((m) => /table/i.test(m.name)), 'Compound queries must match every term')
assert.ok(search('餐桌').every((m) => !/lamp|coffee|side|sink/i.test(m.name)))
assert.ok(search('书桌').every((m) => m.type === 'TABLES'), 'Desk chairs should not match the Chinese word for desks')
assert.equal(search('no-such-furniture-xyz').length, 0)
assert.equal(search('  ').length, models.length)

const upload: ModelDef = {
  id: 'upload:test', name: '我的蓝色沙发', type: 'OTHER', brand: 'MY UPLOADS', kind: 'upload', footprint: [1, 1],
}
assert.ok(matchesModelSearch(upload, '蓝色 沙发'), 'Uploaded names remain searchable')
assert.ok(matchesModelSearch({ ...upload, name: 'Blue Couch' }, '蓝色') === false)
assert.ok(matchesModelSearch({ ...upload, name: 'Blue Couch' }, '沙发 blue'))
console.log('Model search: Chinese aliases, synonyms, compound queries, brands and uploads passed')
