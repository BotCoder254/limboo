/** Ambient typing for `unbzip2-stream` (ships no types). */
declare module 'unbzip2-stream' {
  import type { Duplex } from 'node:stream';
  /** Create a bzip2 decompression transform stream. */
  function unbzip2Stream(): Duplex;
  export default unbzip2Stream;
}
