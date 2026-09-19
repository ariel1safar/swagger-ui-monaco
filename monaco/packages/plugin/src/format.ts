import { applyEdits, format, parse, type ParseError } from 'jsonc-parser';

/** Change only whitespace so large numbers and escaped strings retain their wire representation. */
export function formatJsonResponse(text: string): string {
  const errors: ParseError[] = [];
  parse(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (errors.length) throw new Error('Invalid JSON');
  return applyEdits(text, format(text, undefined, { tabSize: 2, insertSpaces: true, eol: '\n' }));
}
