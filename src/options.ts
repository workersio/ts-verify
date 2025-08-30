export interface Options {
  filename: string;
  z3path: string;
  remote: boolean;
  z3url: string;
  qi: boolean;
  timeout: number;
  logformat: 'simple' | 'colored' | 'html';
  quiet: boolean;
  verbose: boolean;
  logsmt: string;
  maxInterpreterSteps: number;
}

const defaultOptions: Readonly<Options> = {
  filename: '',
  z3path: 'z3',
  remote: false,
  z3url: '/z3',
  qi: true,
  timeout: 5,
  logformat: 'colored',
  quiet: true,
  verbose: false,
  logsmt: '/tmp/vc.smt',
  maxInterpreterSteps: 10000
};

let options: Readonly<Options> = defaultOptions; // global singleton options object

export function getOptions(): Readonly<Options> {
  return options;
}

export function setOptions(opts: Partial<Options>) {
  options = Object.assign({}, options, opts);
}
