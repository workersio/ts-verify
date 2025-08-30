// Array Operations
const a1 = [23];
assert(a1 instanceof Array);
assert(a1 instanceof Object);
assert('length' in a1);
assert(a1.length === 1);
assert(0 in a1);
assert(a1[0] > 22);
const p = 3 - 2 - 1;
assert(a1[p] > 22);
const arr = [1, 2, 3];
const sliced = arr.slice(1, 2);
assert(sliced.length === 1);
assert(sliced[0] === 2);
