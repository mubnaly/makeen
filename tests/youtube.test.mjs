import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYouTube, youtubeDocId, qualityLabel, normalizeQualities, activeCueAt, parseYoutubePlaylistHtml
} from '../src/lib/youtube.js';

const ID = 'dQw4w9WgXcQ';
const LIST = 'PLabc123_-XYZ';

test('parses every common YouTube video link shape', () => {
  for (const input of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    ID // a bare id
  ]) {
    const parsed = parseYouTube(input);
    assert.ok(parsed, `parses: ${input}`);
    assert.equal(parsed.type, 'video', input);
    assert.equal(parsed.id, ID, input);
    assert.ok(parsed.url.includes(`v=${ID}`));
    assert.ok(parsed.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/'));
  }
});

test('parses playlist links and keeps watch+list as the video', () => {
  const playlist = parseYouTube(`https://www.youtube.com/playlist?list=${LIST}`);
  assert.equal(playlist.type, 'playlist');
  assert.equal(playlist.id, LIST);
  assert.ok(playlist.embedUrl.includes('listType=playlist'));
  assert.ok(playlist.embedUrl.includes(`list=${LIST}`));

  // A video opened inside a playlist: the pasted video is the intent.
  const watch = parseYouTube(`https://www.youtube.com/watch?v=${ID}&list=${LIST}`);
  assert.equal(watch.type, 'video');
  assert.equal(watch.id, ID);
});

test('rejects non-YouTube and malformed links', () => {
  assert.equal(parseYouTube(''), null);
  assert.equal(parseYouTube('   '), null);
  assert.equal(parseYouTube('https://vimeo.com/12345'), null);
  assert.equal(parseYouTube('not a link at all'), null);
  assert.equal(parseYouTube('https://www.youtube.com/watch?v=short'), null, 'id must be 11 chars');
  assert.equal(parseYouTube('https://evil-youtube.com/watch?v=' + ID), null, 'lookalike host');
  assert.equal(parseYouTube(null), null);
});

test('youtubeDocId is stable, ASCII and filesystem safe', () => {
  assert.equal(youtubeDocId(parseYouTube(`https://youtu.be/${ID}`)), `yt-video-${ID}`);
  assert.equal(youtubeDocId(parseYouTube(`https://www.youtube.com/playlist?list=${LIST}`)), `yt-list-${LIST}`);
  assert.equal(youtubeDocId(null), '');
  assert.ok(!/[^a-z0-9-]/i.test(youtubeDocId(parseYouTube(ID))));
});

test('quality levels are labelled and filtered to requestable values', () => {
  assert.equal(qualityLabel('hd1080'), '1080p');
  assert.equal(qualityLabel('HIGHRES'), '4K+');
  assert.equal(qualityLabel('tiny'), '144p');
  assert.equal(qualityLabel('weird'), 'weird');
  assert.equal(qualityLabel(''), '');
  assert.deepEqual(
    normalizeQualities(['hd1080', 'HD1080', 'tiny', 'auto', 'bogus', 'hd720']),
    ['hd1080', 'tiny', 'hd720']
  );
  assert.deepEqual(normalizeQualities(null), []);
});

test('the active caption follows playback and respects gaps', () => {
  const cues = [
    { start: 0, duration: 2, text: 'a' },
    { start: 2, duration: 1, text: 'b' },
    { start: 5, duration: 2, text: 'c' }
  ];
  assert.equal(activeCueAt(cues, -1), -1);
  assert.equal(activeCueAt(cues, 0), 0);
  assert.equal(activeCueAt(cues, 1.9), 0);
  assert.equal(activeCueAt(cues, 2), 1);
  assert.equal(activeCueAt(cues, 3.5), -1, 'silence between cues is not pinned to the previous line');
  assert.equal(activeCueAt(cues, 5), 2);
  assert.equal(activeCueAt(cues, 99), -1);
  assert.equal(activeCueAt([], 1), -1);
  assert.equal(activeCueAt(null, 1), -1);
  assert.equal(activeCueAt(cues, NaN), -1);
  const open = [{ start: 4, text: 'no duration' }];
  assert.equal(activeCueAt(open, 10), 0);
});

test('parseYoutubePlaylistHtml extracts videos from ytInitialData', () => {
  const mockJson = {
    metadata: {
      playlistMetadataRenderer: { title: 'قائمة تجريبية' }
    },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [{
                  itemSectionRenderer: {
                    contents: [{
                      playlistVideoListRenderer: {
                        contents: [
                          {
                            playlistVideoRenderer: {
                              videoId: 'video123456',
                              title: { runs: [{ text: 'الدرس الأول: مقدمة' }] },
                              thumbnail: { thumbnails: [{ url: 'https://example.com/thumb1.jpg' }] },
                              lengthSeconds: '120'
                            }
                          },
                          {
                            playlistVideoRenderer: {
                              videoId: 'video789012',
                              title: { simpleText: 'الدرس الثاني: التطبيق' },
                              thumbnail: { thumbnails: [{ url: 'https://example.com/thumb2.jpg' }] },
                              lengthSeconds: '240'
                            }
                          }
                        ]
                      }
                    }]
                  }
                }]
              }
            }
          }
        }]
      }
    }
  };

  const html = `<!DOCTYPE html><html><head><script>var ytInitialData = ${JSON.stringify(mockJson)};</script></head><body></body></html>`;
  const result = parseYoutubePlaylistHtml(html);

  assert.equal(result.ok, true);
  assert.equal(result.title, 'قائمة تجريبية');
  assert.equal(result.count, 2);
  assert.equal(result.videos.length, 2);
  assert.equal(result.videos[0].id, 'video123456');
  assert.equal(result.videos[0].title, 'الدرس الأول: مقدمة');
  assert.equal(result.videos[0].url, 'https://www.youtube.com/watch?v=video123456');
  assert.equal(result.videos[0].duration, 120);
  assert.equal(result.videos[1].id, 'video789012');
  assert.equal(result.videos[1].title, 'الدرس الثاني: التطبيق');
});
