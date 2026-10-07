const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../fc-snipe-helper.user.js');

test('nextPrice folgt den Preisstufen', () => {
  assert.equal(p.nextPrice(0), 200);
  assert.equal(p.nextPrice(150), 200);
  assert.equal(p.nextPrice(200), 250);
  assert.equal(p.nextPrice(950), 1000);
  assert.equal(p.nextPrice(1000), 1100);
  assert.equal(p.nextPrice(9900), 10000);
  assert.equal(p.nextPrice(10000), 10250);
  assert.equal(p.nextPrice(49750), 50000);
  assert.equal(p.nextPrice(50000), 50500);
  assert.equal(p.nextPrice(99500), 100000);
  assert.equal(p.nextPrice(100000), 101000);
  assert.equal(p.nextPrice(15000000), 15000000);
});

test('floorToValid rundet auf gültige Preise ab', () => {
  assert.equal(p.floorToValid(199), 0);
  assert.equal(p.floorToValid(999), 950);
  assert.equal(p.floorToValid(1049), 1000);
  assert.equal(p.floorToValid(10249), 10000);
  assert.equal(p.floorToValid(10250), 10250);
  assert.equal(p.floorToValid(50499), 50000);
  assert.equal(p.floorToValid(100999), 100000);
  assert.equal(p.floorToValid(99999999), 15000000);
});

test('afterTax zieht 5 % ab', () => {
  assert.equal(p.afterTax(10000), 9500);
  assert.equal(p.afterTax(1000), 950);
  assert.equal(p.afterTax(150), 142);
  assert.equal(p.afterTax(12345), 11727);
});

test('maxBuyFor und profitOf', () => {
  assert.equal(p.maxBuyFor(12000, 1000), 10250);
  assert.equal(p.maxBuyFor(12000), 11250);
  assert.equal(p.profitOf(10250, 12000), 1150);
  assert.equal(p.profitOf(12000, 12000), -600);
});

test('parseCoins liest formatierte Preise', () => {
  assert.equal(p.parseCoins('10.000'), 10000);
  assert.equal(p.parseCoins('1,250'), 1250);
  assert.equal(p.parseCoins('---'), 0);
  assert.equal(p.parseCoins(''), 0);
});

test('nextMinBin erhöht und setzt nach dem Zyklus zurück', () => {
  let state = { value: 0, bumps: 0 };
  const seen = [];
  for (let i = 0; i < 5; i++) {
    state = p.nextMinBin(state.value, 10000, state.bumps, 3);
    seen.push(state.value);
  }
  assert.deepEqual(seen, [200, 250, 300, 0, 200]);
});

test('nextMinBin bleibt unter dem Max. Sofortkauf', () => {
  assert.deepEqual(p.nextMinBin(9800, 10000, 2, 10), { value: 9900, bumps: 3 });
  assert.deepEqual(p.nextMinBin(9900, 10000, 3, 10), { value: 0, bumps: 0 });
});
