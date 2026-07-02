/** Vite `?url` asset imports. */
declare module '*?url' {
  const url: string;
  export default url;
}

/** Vite `?raw` string imports (the AudioWorklet module is inlined as source). */
declare module '*?raw' {
  const src: string;
  export default src;
}
