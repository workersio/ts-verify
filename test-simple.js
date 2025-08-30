const { verify } = require('./build/main/index.js');

async function test() {
  const result = await verify(`
    function f(x) {
      requires(typeof(x) === "number");
      assert(x > 0);
      return x;
    }
  `, { verbose: true });
  console.log(JSON.stringify(result, null, 2));
}

test().catch(console.error);
