import { Syntax, id, nullLoc } from './javascript';
import { FreeVar, Vars } from './logic';
import { MessageException } from './message';
import { getOptions } from './options';
import { SMTOutput } from './smt';
import { SExpr, matchSExpr, parseSExpr } from './util';
import { stringifyExpression } from './codegen';

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSVal {
  export interface Num {
    type: 'num';
    v: number;
  }
  export interface Bool {
    type: 'bool';
    v: boolean;
  }
  export interface Str {
    type: 'str';
    v: string;
  }
  export interface Null {
    type: 'null';
  }
  export interface Undefined {
    type: 'undefined';
  }
  export interface Fun {
    type: 'fun';
    body: Syntax.FunctionExpression;
  }
  export interface Obj {
    type: 'obj';
    v: { [key: string]: JSVal };
  }
  export interface ObjCls {
    type: 'obj-cls';
    cls: string;
    args: Array<Value>;
  }
  export interface Arr {
    type: 'arr';
    elems: Array<Value>;
  }
  export type Value = Num | Bool | Str | Null | Undefined | Fun | Obj | ObjCls | Arr;
}

export type JSVal = JSVal.Value;

interface LazyObjCls {
  type: 'obj-cls';
  cls: string;
  args: Array<LazyValue>;
}
interface ArrRef {
  type: 'arr-ref';
  name: string;
}
interface ObjRef {
  type: 'obj-ref';
  name: string;
}
interface FunRef {
  type: 'fun-ref';
  name: string;
}
interface Loc {
  type: 'loc';
  name: string;
}
type LazyValue =
  | JSVal.Num
  | JSVal.Bool
  | JSVal.Str
  | JSVal.Null
  | JSVal.Undefined
  | JSVal.Obj
  | LazyObjCls
  | ArrRef
  | ObjRef
  | FunRef;
type ArrLengths = (arr: ArrRef) => number;
type ArrElems = (arr: ArrRef, idx: number) => LazyValue;
type ObjProperties = (obj: ObjRef) => string;
type ObjFields = (obj: ObjRef, prop: string) => LazyValue;
type HeapMapping = (loc: Loc) => LazyValue;
interface LazyFun {
  type: 'fun';
  body: Array<{ cond: Array<JSVal>; ret: LazyValue }>;
}

export function plainToJSVal(val: any): JSVal {
  if (typeof val === 'number') {
    return { type: 'num', v: val };
  } else if (typeof val === 'boolean') {
    return { type: 'bool', v: val };
  } else if (typeof val === 'string') {
    return { type: 'str', v: val };
  } else if (val === null) {
    return { type: 'null' };
  } else if (val === undefined) {
    return { type: 'undefined' };
  } else if (val instanceof Array) {
    return { type: 'arr', elems: val.map(plainToJSVal) };
  } else if ('_cls_' in val && '_args_' in val) {
    return { type: 'obj-cls', cls: val._cls_, args: val._args_.map(plainToJSVal) };
  } else if (typeof val === 'object') {
    const obj: { [key: string]: JSVal } = {};
    Object.keys(val).forEach((key) => (obj[key] = plainToJSVal(val[key])));
    return { type: 'obj', v: obj };
  } else {
    throw new Error('unsupported ');
  }
}

export function valueToJavaScript(val: JSVal): Syntax.Expression {
  switch (val.type) {
    case 'num':
    case 'bool':
    case 'str':
      return { type: 'Literal', value: val.v, loc: nullLoc() };
    case 'null':
      return { type: 'Literal', value: null, loc: nullLoc() };
    case 'undefined':
      return { type: 'Literal', value: undefined, loc: nullLoc() };
    case 'fun':
      return val.body;
    case 'obj':
      return {
        type: 'ObjectExpression',
        properties: Object.keys(val.v).map((key) => ({ key, value: valueToJavaScript(val.v[key]) })),
        loc: nullLoc()
      };
    case 'obj-cls':
      return {
        type: 'NewExpression',
        callee: id(val.cls),
        args: val.args.map((arg) => valueToJavaScript(arg)),
        loc: nullLoc()
      };
    case 'arr':
      return {
        type: 'ArrayExpression',
        elements: val.elems.map((arg) => valueToJavaScript(arg)),
        loc: nullLoc()
      };
  }
}

export function valueToPlain(val: JSVal): any {
  switch (val.type) {
    case 'num':
    case 'bool':
    case 'str':
      return val.v;
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'fun':
      /* tslint:disable:no-eval */
      return eval(`(() => ${stringifyExpression(val.body)})()`);
    case 'obj':
      const obj: { [key: string]: any } = {};
      Object.keys(val.v).forEach((key) => (obj[key] = valueToPlain(val.v[key])));
      return obj;
    case 'obj-cls':
      // FIXME: use class instance
      return `new ${val.cls}(${val.args.map((arg) => valueToPlain(arg)).join(', ')})`;
    case 'arr':
      return val.elems.map((elem) => valueToPlain(elem));
  }
}

export function valueToString(val: JSVal): string {
  switch (val.type) {
    case 'num':
    case 'bool':
    case 'str':
      return String(val.v);
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    case 'fun':
      const str = stringifyExpression(val.body);
      return str.substr(1, str.length - 2); // remove outer parens
    case 'obj':
      const formatKey = (s: string) => (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) ? s : '"' + s + '"');
      return `{ ${Object.keys(val.v)
        .map((key) => `${formatKey(key)}:${valueToString(val.v[key])}`)
        .join(', ')} }`;
    case 'obj-cls':
      return `new ${val.cls}(${val.args.map((arg) => valueToString(arg)).join(', ')})`;
    case 'arr':
      return `[${val.elems.map((elem) => valueToString(elem)).join(', ')}]`;
  }
}

export class Model {
  private arrLengths: ArrLengths | null = null;
  private arrElems: ArrElems | null = null;
  private objProperties: ObjProperties | null = null;
  private objPropertyMappings: { [varname: string]: Set<string> } = {};
  private objFields: ObjFields | null = null;
  private heapMappings: { [varname: string]: HeapMapping } = {};
  private vars: { [varname: string]: LazyValue } = {};
  private locs: { [varname: string]: Loc } = {};
  private heaps: Array<string> = [];
  private funs: { [funcref: string]: Array<LazyFun> } = {};
  private funDefaults: Array<LazyValue> = [];

  constructor(smt: SMTOutput) {
    // assumes smt starts with "sat", so remove "sat"
    const smt2 = smt.slice(3, smt.length);
    if (smt2.trim().startsWith('(error')) this.modelError(smt2.trim());
    let data: SExpr;
    try {
      data = parseSExpr(smt2.trim());
    } catch (e) {
      throw this.modelError(e instanceof Error ? e.message : String(e));
    }
    if (typeof data === 'string') throw this.modelError(data);
    if (data.length < 2) throw this.modelError(smt);
    if (data[0] !== 'model') throw this.modelError(smt);
    data.slice(1).forEach((s) => this.parseDefinition(s));
  }

  public valueOf(name: FreeVar): JSVal {
    if (typeof name === 'string') {
      const val = this.vars[name];
      if (!val) return { type: 'undefined' };
      return this.hydrate(val);
    } else {
      const loc = this.locs[name.name];
      if (!loc) throw this.modelError(`no such loc ${name.name}`);
      const heap = this.heapMappings[this.heaps[name.heap]];
      if (!heap) throw this.modelError(`no such heap ${name.heap}`);
      return this.hydrate(heap(loc));
    }
  }

  public variables(): Vars {
    return new Set([...Object.keys(this.vars), ...Object.keys(this.locs)]);
  }

  public mutableVariables(): Vars {
    return new Set([...Object.keys(this.locs)]);
  }

  private parseDefinition(data: SExpr) {
    if (typeof data === 'string' || data.length < 1) {
      throw this.modelError('expected define-fun');
    }
    const m = matchSExpr(data, [
      'define-fun',
      { name: 'name' },
      { group: 'args' },
      { expr: 'return' },
      { expr: 'body' }
    ]);
    if (m === null) return; // skip everything except for define-fun
    const name: string = m.name as string;
    if (name.startsWith('v_')) {
      this.vars[name.substr(2)] = this.parseLazyValue(m.body);
    } else if (name.startsWith('l_')) {
      const locVal = m.body;
      if (typeof locVal !== 'string') throw this.modelError('expected loc');
      this.locs[name.substr(2)] = { type: 'loc', name: locVal };
    } else if (name.startsWith('h_')) {
      this.heaps[parseInt(name.substr(2), 10)] = this.parseHeap(m.body);
    } else if (name === 'arrlength') {
      this.arrLengths = this.parseArrayLengths(m.body);
    } else if (name === 'arrelems') {
      this.arrElems = this.parseArrayElems(m.body);
    } else if (name === 'objproperties') {
      this.objProperties = this.parseObjectProperties(m.body);
    } else if (name === 'objfield') {
      this.objFields = this.parseObjectFields(m.body);
    } else if (name.startsWith('c_')) {
      return; // skip class names
    } else if (name.startsWith('app')) {
      this.parseFunctions(m.body, parseInt(name.substr(3), 10));
    } else if (name.startsWith('pre') || name.startsWith('post') || name.startsWith('eff') || name.startsWith('call')) {
      return; // skip functions
    } else {
      const heapMatch = matchSExpr(data, ['define-fun', { name: 'name' }, [['x!0', 'Loc']], 'JSVal', { expr: 'body' }]);
      if (heapMatch !== null) {
        this.heapMappings[heapMatch.name as string] = this.parseHeapMapping(heapMatch.body);
      } else {
        const propertiesMatch = matchSExpr(data, [
          'define-fun',
          { name: 'name' },
          [['x!0', 'String']],
          'Bool',
          { expr: 'body' }
        ]);
        if (propertiesMatch !== null) {
          const mapping = this.parsePropertyMapping(propertiesMatch.body);
          this.objPropertyMappings[propertiesMatch.name as string] = mapping === null ? new Set() : mapping;
        } else {
          throw this.modelError(`unexpected key: ${name}`);
        }
      }
    }
  }

  private modelError(smt: SMTOutput): MessageException {
    return new MessageException({
      status: 'error',
      type: 'unrecognized-model',
      loc: { file: getOptions().filename, start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      description: `cannot parse smt ${smt}`
    });
  }

  private parseNum(v: SExpr): JSVal.Num {
    if (typeof v === 'string') {
      // Handle both plain numbers and special representations
      const num = parseFloat(v);
      if (!isNaN(num)) {
        return { type: 'num', v: num };
      }
      // Handle hexadecimal notation
      if (v.startsWith('#x')) {
        const hexNum = parseInt(v.substr(2), 16);
        if (!isNaN(hexNum)) {
          return { type: 'num', v: hexNum };
        }
      }
      // Handle binary notation
      if (v.startsWith('#b')) {
        const binNum = parseInt(v.substr(2), 2);
        if (!isNaN(binNum)) {
          return { type: 'num', v: binNum };
        }
      }
      throw this.modelError(`cannot parse number ${v}`);
    }
    
    // Handle complex numeric expressions
    if (!Array.isArray(v) || v.length === 0) {
      throw this.modelError(`cannot parse number ${v}`);
    }
    
    const op = v[0];
    
    if (op === '-' && v.length === 2) {
      const num = this.parseNum(v[1]);
      return { type: 'num', v: -num.v };
    } else if (op === '/' && v.length === 3) {
      const n = this.parseNum(v[1]);
      const d = this.parseNum(v[2]);
      return { type: 'num', v: n.v / d.v };
    } else if (op === '*' && v.length === 3) {
      const left = this.parseNum(v[1]);
      const right = this.parseNum(v[2]);
      return { type: 'num', v: left.v * right.v };
    } else if (op === '+' && v.length === 3) {
      const left = this.parseNum(v[1]);
      const right = this.parseNum(v[2]);
      return { type: 'num', v: left.v + right.v };
    } else if (op === 'to_real' && v.length === 2) {
      // Convert integer to real
      const num = this.parseNum(v[1]);
      return { type: 'num', v: num.v };
    } else if (op === 'to_int' && v.length === 2) {
      // Convert real to integer
      const num = this.parseNum(v[1]);
      return { type: 'num', v: Math.floor(num.v) };
    }
    
    throw this.modelError(`cannot parse number expression ${JSON.stringify(v)}`);
  }

  private parseStringValue(v: SExpr): string | null {
    if (typeof v === 'string') {
      // Simple string literal wrapped in quotes
      if (v.startsWith('"') && v.endsWith('"')) {
        const vchars = v.substr(1, v.length - 2);
        // replace "\x00" with "\0", etc.
        const vreplaced = vchars.replace(/\\x(\d\d)/g, (m, c) => String.fromCharCode(parseInt(c, 16)));
        return vreplaced;
      }
      // Empty string represented as empty quotes
      if (v === '""') {
        return '';
      }
      return null;
    }
    
    // Handle complex Z3 string expressions
    if (!Array.isArray(v) || v.length === 0) return null;
    const op = v[0];
    
    if (op === 'str.++') {
      // String concatenation
      let result = '';
      for (let i = 1; i < v.length; i++) {
        const part = this.parseStringValue(v[i]);
        if (part === null) return null;
        result += part;
      }
      return result;
    } else if (op === 'seq.unit') {
      // Single character from code point
      if (v.length !== 2) return null;
      const charCode = this.parseCharCode(v[1]);
      if (charCode === null) return null;
      return String.fromCharCode(charCode);
    } else if (op === 'str.from_code') {
      // Character from code  
      if (v.length !== 2) return null;
      const charCode = this.parseCharCode(v[1]);
      if (charCode === null) return null;
      return String.fromCharCode(charCode);
    } else if (op === 'str.at') {
      // String indexing - we'll treat this as unparseable for now
      return null;
    }
    
    return null;
  }

  private parseCharCode(v: SExpr): number | null {
    if (typeof v === 'string') {
      const num = parseInt(v, 10);
      if (!isNaN(num)) return num;
    } else if (Array.isArray(v) && v.length === 2 && v[0] === 'char') {
      // Handle (char #xNN) format
      const charLit = v[1];
      if (typeof charLit === 'string') {
        if (charLit.startsWith('#x')) {
          return parseInt(charLit.substr(2), 16);
        } else if (charLit.startsWith('#b')) {
          return parseInt(charLit.substr(2), 2);
        }
      }
    }
    return null;
  }

  private tryParseSimpleValue(s: SExpr): JSVal | null {
    if (typeof s === 'string') {
      if (s === 'jsundefined') {
        return { type: 'undefined' };
      } else if (s === 'jsnull') {
        return { type: 'null' };
      } else {
        return null;
      }
    } else {
      if (s.length < 1) return null;
      const tag = s[0];
      if (typeof tag !== 'string') return null;
      if (tag === 'jsbool') {
        if (s.length !== 2) return null;
        const v = s[1];
        if (typeof v !== 'string') return null;
        return { type: 'bool', v: v === 'true' };
      } else if (tag === 'jsint' || tag === 'jsreal') {
        if (s.length !== 2) return null;
        return this.parseNum(s[1]);
      } else if (tag === 'jsstr') {
        if (s.length !== 2) return null;
        const v = s[1];
        const strValue = this.parseStringValue(v);
        if (strValue === null) return null;
        return { type: 'str', v: strValue };
      } else {
        return null;
      }
    }
  }

  private parseLazyValue(s: SExpr): LazyValue {
    if (typeof s === 'string') {
      if (s === 'jsundefined') {
        return { type: 'undefined' };
      } else if (s === 'jsnull') {
        return { type: 'null' };
      } else if (s.startsWith('jsobj_')) {
        return { type: 'obj-cls', cls: s.substr(6), args: [] };
      } else if (s.startsWith('Arr!')) {
        return { type: 'arr-ref', name: s };
      } else {
        throw this.modelError(s);
      }
    } else {
      if (s.length < 1) throw this.modelError(s.toString());
      const tag = s[0];
      if (typeof tag !== 'string') throw this.modelError(tag.toString());
      if (tag === 'jsbool') {
        if (s.length !== 2) throw this.modelError(s.toString());
        const v = s[1];
        if (typeof v !== 'string') throw this.modelError(s.toString());
        return { type: 'bool', v: v === 'true' };
      } else if (tag === 'jsint' || tag === 'jsreal') {
        if (s.length !== 2) throw this.modelError(s.toString());
        return this.parseNum(s[1]);
      } else if (tag === 'jsstr') {
        if (s.length !== 2) throw this.modelError(s.toString());
        const v = s[1];
        const strValue = this.parseStringValue(v);
        if (strValue === null) throw this.modelError('cannot parse string value');
        return { type: 'str', v: strValue };
      } else if (tag === 'jsfun') {
        if (s.length !== 2) throw this.modelError(s.toString());
        const v = s[1];
        if (typeof v !== 'string') throw this.modelError(s.toString());
        return { type: 'fun-ref', name: v };
      } else if (tag === 'jsobj') {
        if (s.length !== 2) throw this.modelError(s.toString());
        const v = s[1];
        if (typeof v !== 'string') throw this.modelError(s.toString());
        return { type: 'obj-ref', name: v };
      } else if (tag === 'jsobj_Array') {
        if (s.length !== 2) throw this.modelError(s.toString());
        const v = s[1];
        if (typeof v !== 'string') throw this.modelError(s.toString());
        return { type: 'arr-ref', name: v };
      } else if (tag.startsWith('jsobj_')) {
        return {
          type: 'obj-cls',
          cls: tag.substr(6),
          args: s.slice(1).map((a) => this.parseLazyValue(a))
        };
      } else {
        throw this.modelError(tag);
      }
    }
  }

  private parseHeap(smt: SExpr): string {
    const m = matchSExpr(smt, ['_', 'as-array', { name: 'name' }]);
    if (!m) throw this.modelError('expected (_ as-array $name)');
    return m.name as string;
  }

  private parseHeapMapping(smt: SExpr): HeapMapping {
    const iteMatch = matchSExpr(smt, ['ite', ['=', 'x!0', { name: 'loc' }], { expr: 'then' }, { expr: 'els' }]);
    if (iteMatch) {
      const then = this.parseHeapMapping(iteMatch.then);
      const els = this.parseHeapMapping(iteMatch.els);
      return (loc: Loc) => (loc.name === iteMatch.loc ? then(loc) : els(loc));
    } else {
      const val: LazyValue = this.parseLazyValue(smt);
      return (loc: Loc) => val;
    }
  }

  private parseArrayLengths(smt: SExpr): ArrLengths {
    const iteMatch = matchSExpr(smt, ['ite', ['=', 'x!0', { name: 'arr' }], { expr: 'then' }, { expr: 'els' }]);
    if (iteMatch) {
      const then = this.parseArrayLengths(iteMatch.then);
      const els = this.parseArrayLengths(iteMatch.els);
      return (arrRef: ArrRef) => (arrRef.name === iteMatch.arr ? then(arrRef) : els(arrRef));
    } else {
      if (typeof smt !== 'string') throw this.modelError('expected num');
      return (arrRef: ArrRef) => parseInt(smt, 10);
    }
  }

  private parseArrayElems(smt: SExpr): ArrElems {
    const iteMatch = matchSExpr(smt, [
      'ite',
      ['and', ['=', 'x!0', { name: 'arr' }], ['=', 'x!1', { name: 'i' }]],
      { expr: 'then' },
      { expr: 'els' }
    ]);
    if (iteMatch) {
      const then = this.parseArrayElems(iteMatch.then);
      const els = this.parseArrayElems(iteMatch.els);
      const arr = iteMatch.arr as string;
      const i = parseInt(iteMatch.i as string, 10);
      return (arrRef: ArrRef, idx: number) => (arrRef.name === arr && idx === i ? then(arrRef, idx) : els(arrRef, idx));
    } else {
      const val: LazyValue = this.parseLazyValue(smt);
      return (arrRef: ArrRef, idx: number) => val;
    }
  }

  private parseFunctions(smt: SExpr, numArgs: number): void {
    // only find direct matches and treat final value explicitly
    const iteMatch = matchSExpr(smt, ['ite', { group: 'cond' }, { expr: 'then' }, { expr: 'els' }]);
    if (!iteMatch) {
      this.funDefaults[numArgs] = this.parseLazyValue(smt);
      return;
    }
    this.parseFunctions(iteMatch.els, numArgs); // process remaining functions first
    const condList = iteMatch.cond as Array<string>;
    if (condList.length < 3 || condList[0] !== 'and') throw this.modelError('expected (and ...)');
    const funcMatch = matchSExpr(condList[1], ['=', 'x!0', ['jsfun', { name: 'func' }]]);
    if (!funcMatch) return; // skip non-function value mappings
    const funcName = funcMatch.func as string;
    const funcBlocks: Array<LazyFun> = funcName in this.funs ? this.funs[funcName] : (this.funs[funcName] = []);
    const fun: LazyFun =
      numArgs in funcBlocks ? funcBlocks[numArgs] : (funcBlocks[numArgs] = { type: 'fun', body: [] });
    const fullCond: Array<JSVal> = [];
    // ignore 'and', func match, this arg and heap cond -> remaining part of cond are arguments
    for (let idx = 4; idx < condList.length; idx++) {
      const condMatch = matchSExpr(condList[idx], ['=', `x!${idx - 1}`, { expr: 'val' }]);
      if (!condMatch) throw this.modelError('expected (= x!idx $val)');
      const matchVal: JSVal | null = this.tryParseSimpleValue(condMatch.val);
      if (!matchVal) return;
      fullCond.push(matchVal);
    }
    const then = this.parseLazyValue(iteMatch.then);
    fun.body.unshift({ cond: fullCond, ret: then });
  }

  private parseObjectProperties(smt: SExpr): ObjProperties {
    const iteMatch = matchSExpr(smt, ['ite', ['=', 'x!0', { name: 'obj' }], { expr: 'then' }, { expr: 'els' }]);
    if (iteMatch) {
      const then = this.parseObjectProperties(iteMatch.then);
      const els = this.parseObjectProperties(iteMatch.els);
      return (objRef: ObjRef) => (objRef.name === iteMatch.obj ? then(objRef) : els(objRef));
    }
    const asArrayMatch = matchSExpr(smt, ['_', 'as-array', { name: 'name' }]);
    if (!asArrayMatch) throw this.modelError('expected (_ as-array $name)');
    return (objRef: ObjRef) => asArrayMatch.name as string;
  }

  private parsePropertyMapping(smt: SExpr): Set<string> | null {
    const iteMatch = matchSExpr(smt, ['ite', ['=', 'x!0', { name: 'prop' }], { expr: 'then' }, { expr: 'els' }]);
    if (iteMatch) {
      const then = this.parsePropertyMapping(iteMatch.then);
      const els = this.parsePropertyMapping(iteMatch.els);
      const prop = iteMatch.prop;
      
      // Handle both simple string literals and complex string expressions
      let propStr: string | null = null;
      if (typeof prop === 'string') {
        if (prop.length >= 2 && prop[0] === '"' && prop[prop.length - 1] === '"') {
          propStr = prop.substr(1, prop.length - 2);
        }
      } else {
        // Try to parse complex string expression
        propStr = this.parseStringValue(prop);
      }
      
      if (propStr === null) {
        throw this.modelError('expected string in property mapping');
      }
      
      if (then === null) {
        // if (p = "prop") then false else $x -> $x
        return els;
      } else if (els === null) {
        // if (p = "prop") then $x else false -> ["prop", $x]
        return new Set([propStr, ...then]);
      } else {
        // if (p = "prop") then $x else $y -> ["prop", $x, $y]
        return new Set([propStr, ...then, ...els]);
      }
    } else if (smt === 'true') {
      // include properties on path
      return new Set();
    } else if (smt === 'false') {
      // do not include properties on path
      return null;
    } else {
      throw this.modelError('expected (true)');
    }
  }

  private parseObjectFields(smt: SExpr): ObjFields {
    const iteMatch = matchSExpr(smt, [
      'ite',
      ['and', ['=', 'x!0', { name: 'obj' }], ['=', 'x!1', { name: 's' }]],
      { expr: 'then' },
      { expr: 'els' }
    ]);
    if (iteMatch) {
      const then = this.parseObjectFields(iteMatch.then);
      const els = this.parseObjectFields(iteMatch.els);
      const arr = iteMatch.obj as string;
      const str = iteMatch.s;
      
      // Handle both simple string literals and complex string expressions
      let strValue: string | null = null;
      if (typeof str === 'string') {
        if (str.length >= 2 && str[0] === '"' && str[str.length - 1] === '"') {
          strValue = str.substr(1, str.length - 2);
        }
      } else {
        // Try to parse complex string expression
        strValue = this.parseStringValue(str);
      }
      
      if (strValue === null) {
        throw this.modelError('expected string in object field');
      }
      
      return (objRef: ObjRef, prop: string) =>
        objRef.name === arr && prop === strValue ? then(objRef, prop) : els(objRef, prop);
    } else {
      const val: LazyValue = this.parseLazyValue(smt);
      return (objRef: ObjRef, prop: string) => val;
    }
  }

  private hydrate(val: LazyValue): JSVal {
    switch (val.type) {
      case 'obj-cls':
        return {
          type: 'obj-cls',
          cls: val.cls,
          args: val.args.map((a) => this.hydrate(a))
        };
      case 'fun-ref':
        const body: Array<Syntax.Statement> = [];
        let numArgs = 0;
        if (this.funs && val.name in this.funs) {
          const funcBlocks: Array<LazyFun> = this.funs[val.name];
          if (Object.keys(funcBlocks).length !== 1) {
            throw this.modelError('no support for variable argument functions');
          }
          numArgs = parseInt(Object.keys(funcBlocks)[0], 10);
          const fun = funcBlocks[numArgs];
          let defaultVal = this.funDefaults[numArgs];
          fun.body.forEach(({ cond, ret }) => {
            if (cond.length === 0) {
              defaultVal = ret;
            } else {
              body.push({
                type: 'IfStatement',
                test: cond
                  .map(
                    (condExpr, argIdx): Syntax.Expression => ({
                      type: 'BinaryExpression',
                      operator: '===',
                      left: id(`x_${argIdx}`),
                      right: valueToJavaScript(condExpr),
                      loc: nullLoc()
                    })
                  )
                  .reduceRight((prev, curr) => ({
                    type: 'LogicalExpression',
                    operator: '&&',
                    left: curr,
                    right: prev,
                    loc: nullLoc()
                  })),
                consequent: {
                  type: 'BlockStatement',
                  body: [
                    {
                      type: 'ReturnStatement',
                      argument: valueToJavaScript(this.hydrate(ret)),
                      loc: nullLoc()
                    }
                  ],
                  loc: nullLoc()
                },
                alternate: { type: 'BlockStatement', body: [], loc: nullLoc() },
                loc: nullLoc()
              });
            }
          });
          body.push({
            type: 'ReturnStatement',
            argument: valueToJavaScript(this.hydrate(defaultVal)),
            loc: nullLoc()
          });
        }
        return {
          type: 'fun',
          body: {
            type: 'FunctionExpression',
            id: null,
            params: [...Array(numArgs)].map((_, idx) => id(`x_${idx}`)),
            requires: [],
            ensures: [],
            body: {
              type: 'BlockStatement',
              body,
              loc: nullLoc()
            },
            freeVars: [],
            loc: nullLoc()
          }
        };
      case 'arr-ref':
        if (this.arrLengths === null) throw this.modelError('no arrlength');
        return {
          type: 'arr',
          elems: [...Array(this.arrLengths(val))].map((_, i) => {
            if (this.arrElems === null) throw this.modelError('no arrelems');
            return this.hydrate(this.arrElems(val, i));
          })
        };
      case 'obj-ref':
        if (this.objProperties === null) throw this.modelError('no objproperties');
        if (this.objFields === null) throw this.modelError('no objfields');
        const obj: { [key: string]: JSVal } = {};
        const objAlias: string = this.objProperties(val);
        if (!(objAlias in this.objPropertyMappings)) throw this.modelError(`no mapping for ${this.objProperties(val)}`);
        for (const key of this.objPropertyMappings[objAlias]) {
          obj[key] = this.hydrate(this.objFields(val, key));
        }
        return { type: 'obj', v: obj };
      default:
        return val;
    }
  }
}
