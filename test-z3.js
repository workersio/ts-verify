const { verify } = require('./build/main/index.js');

async function test() {
  const result = await verify(`
    function f(x) {
      const y = x + 1;
      assert(y > 3);
      return 0;
    }
  `);
  console.log(JSON.stringify(result, null, 2));
}

test().catch(console.error);
