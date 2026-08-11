import { Layouter } from './Layouter.js';

export function layoutProcess(xml, options) {
  return new Layouter(options).layoutProcess(xml);
}
