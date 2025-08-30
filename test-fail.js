const { verificationConditions } = require('./build/main/index.js');
const { setOptions } = require('./build/main/index.js');

setOptions({ verbose: true, logsmt: 'debug.smt2' });

const vcs = verificationConditions(`
  function g(x) {
    requires(typeof(x) === "number");
    const res = x + 1;
    assert(res > 3);
    return res;
  }
`);

async function test() {
  if (vcs instanceof Array) {
    for (const vc of vcs) {
      const result = await vc.verify();
      console.log('Result:', JSON.stringify(result, null, 2));
    }
  }
}

test().catch(console.error);
