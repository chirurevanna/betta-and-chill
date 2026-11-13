// hls.js ships its light build (no subtitles / DRM) without its own typings; its API is the same.
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
