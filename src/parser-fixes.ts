import * as estree from 'estree';

export function isBigIntLiteral(value: any): value is bigint {
  return typeof value === 'bigint';
}

export function isPrivateIdentifier(node: any): node is estree.PrivateIdentifier {
  return node && node.type === 'PrivateIdentifier';
}

export function ensureExpression(node: estree.Expression | estree.PrivateIdentifier): estree.Expression {
  if (isPrivateIdentifier(node)) {
    throw new Error('Private identifiers are not supported');
  }
  return node;
}

export function ensureLiteralValue(value: any): undefined | null | boolean | number | string {
  if (isBigIntLiteral(value)) {
    throw new Error('BigInt literals are not supported');
  }
  return value as undefined | null | boolean | number | string;
}
