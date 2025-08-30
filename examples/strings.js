// String Operations
const s1 = 'hello';
assert(s1.length === 5);
const l2 = (s1 + ' world').length;
const l3 = s1.length + ' world'.length;
assert(l2 === l3);
assert(l2 === 11);
const c1 = s1[0];
const c2 = s1[3 - 2];
assert(c1 === 'h');
assert(c2 === 'e');
const str = 'abcd';
const substr = str.substr(1, 2);
assert(substr === 'bc');
