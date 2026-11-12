/**
 * Internet radio stations, hand-picked from the open Radio Browser directory
 * (https://www.radio-browser.info). HTTPS MP3/AAC streams only, so a plain <audio> element
 * can play them without hls.js and without mixed-content warnings.
 *
 * Each station belongs to one language. Pick stations whose directory language tag is exactly
 * that one language (multilingual stations such as Bahrain's Live FM are left out); the player
 * re-checks the tag at runtime and skips a station whose tag stops matching.
 *
 * To add a station: look it up on radio-browser.info, check its stream plays over HTTPS, and
 * append { id, name, lang, url, uuid } below. A language button lights up as soon as it has a
 * station. `uuid` is the Radio Browser stationuuid. Streams © their respective stations.
 */
export type Lang = 'kn' | 'hi' | 'en';

export interface LangInfo {
  id: Lang;
  /** button label */
  label: string;
  name: string;
  /** Radio Browser's language tag */
  tag: string;
}

export const LANGS: readonly LangInfo[] = [
  { id: 'kn', label: 'ಕ', name: 'Kannada', tag: 'kannada' },
  { id: 'hi', label: 'हि', name: 'Hindi', tag: 'hindi' },
  { id: 'en', label: 'EN', name: 'English', tag: 'english' },
];

export interface Station {
  id: string;
  name: string;
  lang: Lang;
  url: string;
  uuid: string;
}

export const STATIONS: readonly Station[] = [
  // Kannada
  { id: 'kannadahits', name: 'Kannada Hits', lang: 'kn', url: 'https://stream.zeno.fm/68snnbug8rhvv', uuid: '7bfa32e7-a239-4f59-904a-fcf602b06404' },
  { id: 'sakkath', name: 'Sakkath Radio', lang: 'kn', url: 'https://stream.zeno.fm/fcsk9ryerd0uv', uuid: '443a1153-10a3-4312-bb74-50c703e8129b' },
  { id: 'girmit', name: 'Radio Girmit', lang: 'kn', url: 'https://stream.radiojar.com/g6dgm6m6p3hvv', uuid: '6533a16a-c01b-4100-adb9-7f2737398fc5' },
  { id: 'namm', name: 'Namm Radio', lang: 'kn', url: 'https://stream.zenolive.com/bbs8prb015quv', uuid: 'cdacacb3-d3ee-4a2b-b57d-d1190472a542' },
  { id: 'amr', name: 'Radio AMR Kannada', lang: 'kn', url: 'https://stream.zeno.fm/7g8axtgtsg0uv', uuid: 'fe9ddd4b-db4d-41ab-940c-dc834089e106' },
  // Hindi
  { id: 'bolly2010s', name: "Bollywood 2010's", lang: 'hi', url: 'https://drive.uber.radio/uber/bollywood2010s/icecast.audio', uuid: '0db90d9a-4ecc-450c-b8fa-695405b24587' },
  { id: 'dilse', name: 'Radio Hungama Bollywood Dil Se', lang: 'hi', url: 'https://stream.zeno.fm/143d7gty24zuv', uuid: 'b17fe09a-96b0-46ef-9e2e-5c56faa9d0aa' },
  { id: 'hindigold', name: 'Hindi Gold Radio', lang: 'hi', url: 'https://azuracast.vibesounds.in:8010/radio.mp3', uuid: '7dd71b85-139b-4362-81b1-4206133a517c' },
  { id: 'bolly90s', name: 'Nostalgic Bollywood 90s', lang: 'hi', url: 'https://www.desizoneradio.com/relay3', uuid: '8d500dcb-6352-4009-aae2-5a095021ff2a' },
  { id: 'retrobolly', name: 'Radio Retro Bollywood', lang: 'hi', url: 'https://stream.zeno.fm/v2zfmxef798uv', uuid: '12f9a2e7-c667-47c9-81de-96bbd79e6375' },
  // English: hits, pop, rap, dance, rock (the first one is what EN starts on)
  { id: 'hiphoprnb', name: '100 Hip Hop and RNB FM', lang: 'en', url: 'https://streaming.shoutcast.com/100-hip-hop-and-rnb-fm', uuid: 'dba1b7bc-6b92-409c-a543-8b42eec25636' },
  { id: 'tophits', name: 'Top Hits', lang: 'en', url: 'https://api.onlyhit.us/tophits', uuid: '01042cd5-5fa0-4667-a023-283cb8aafc92' },
  { id: 'capital', name: 'Capital UK', lang: 'en', url: 'https://media-ssl.musicradio.com/CapitalUK', uuid: '4ad5bdc7-01e5-47c9-a1f9-751671b4707e' },
  { id: 'heartdance', name: 'Heart Dance', lang: 'en', url: 'https://media-ssl.musicradio.com/HeartDanceMP3', uuid: 'fa76f16f-dc31-11e9-a8ba-52543be04c81' },
  { id: 'classicrock', name: 'Classic Rock 70s 80s 90s', lang: 'en', url: 'https://cast1.torontocast.com:4610/stream', uuid: '7afae7e3-8d06-42f5-b59e-a52d6e09e60e' },
];
