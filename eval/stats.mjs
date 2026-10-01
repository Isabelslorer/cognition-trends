// Agreement statistics for the eval harness. Unit tested in test/score.test.mjs.

// Krippendorff's alpha for interval data. units = one array of values per unit (conversation),
// one value per coder that coded it; units with fewer than two values are not pairable and skipped.
// 1 = perfect agreement, 0 = no better than chance. >= 0.8 is reliable, >= 0.667 tentative.
export function krippendorffInterval(units) {
  const pairable = units.filter((values) => values.length >= 2);
  const all = pairable.flat();
  const n = all.length;
  if (n < 2) return null;
  let observed = 0;
  for (const values of pairable) {
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) for (let j = 0; j < values.length; j += 1) if (i !== j) sum += (values[i] - values[j]) ** 2;
    observed += sum / (values.length - 1);
  }
  observed /= n;
  let expected = 0;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) if (i !== j) expected += (all[i] - all[j]) ** 2;
  expected /= n * (n - 1);
  return expected === 0 ? 1 : 1 - observed / expected;
}

// Spearman rank correlation of [x, y] pairs, with average ranks for ties.
export function spearman(pairs) {
  const a = ranks(pairs.map((pair) => pair[0]));
  const b = ranks(pairs.map((pair) => pair[1]));
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i += 1) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : 0;
}

function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
  const out = new Array(values.length);
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j += 1;
    for (let k = i; k <= j; k += 1) out[sorted[k].index] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
