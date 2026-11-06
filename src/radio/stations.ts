/**
 * Kannada internet radio stations, hand-picked from the open Radio Browser directory
 * (https://www.radio-browser.info). HTTPS MP3/AAC streams only, so a plain <audio> element
 * can play them without hls.js and without mixed-content warnings.
 * Kannada-only: every station here is tagged with exactly one language, "kannada", in the
 * directory (multilingual stations such as Bahrain's Live FM are left out). The player
 * re-checks that tag at runtime and skips anything that stops being Kannada-only.
 * `uuid` is the Radio Browser stationuuid. Streams © their respective stations.
 */
export interface Station {
  id: string;
  name: string;
  url: string;
  uuid: string;
}

export const STATIONS: readonly Station[] = [
  { id: 'kannadahits', name: 'Kannada Hits', url: 'https://stream.zeno.fm/68snnbug8rhvv', uuid: '7bfa32e7-a239-4f59-904a-fcf602b06404' },
  { id: 'sakkath', name: 'Sakkath Radio', url: 'https://stream.zeno.fm/fcsk9ryerd0uv', uuid: '443a1153-10a3-4312-bb74-50c703e8129b' },
  { id: 'girmit', name: 'Radio Girmit', url: 'https://stream.radiojar.com/g6dgm6m6p3hvv', uuid: '6533a16a-c01b-4100-adb9-7f2737398fc5' },
  { id: 'namm', name: 'Namm Radio', url: 'https://stream.zenolive.com/bbs8prb015quv', uuid: 'cdacacb3-d3ee-4a2b-b57d-d1190472a542' },
  { id: 'amr', name: 'Radio AMR Kannada', url: 'https://stream.zeno.fm/7g8axtgtsg0uv', uuid: 'fe9ddd4b-db4d-41ab-940c-dc834089e106' },
];
