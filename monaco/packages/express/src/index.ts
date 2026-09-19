import express from 'express';
import upstream from 'swagger-ui-express';
import { getAbsoluteFSPath } from 'swagger-ui-monaco-dist';

type StaticOptions = Parameters<typeof upstream.serveWithOptions>[0];
const assets = (options?: StaticOptions) => express.static(getAbsoluteFSPath(), { ...options, index: false });

export const setup = upstream.setup;
export const generateHTML = upstream.generateHTML;
export const serve = [assets(), ...upstream.serve];
export function serveFiles(...args: Parameters<typeof upstream.serveFiles>) {
  return [assets(), ...upstream.serveFiles(...args)];
}
export function serveWithOptions(options?: StaticOptions) {
  return [assets(options), ...upstream.serveWithOptions(options ?? {})];
}
export default { setup, generateHTML, serve, serveFiles, serveWithOptions };
