import { parseYouTubeId, parseYouTubeStart, cutAction, cutStart } from './videoCuts';

describe('parseYouTubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://vimeo.com/123', null],
    ['not a url', null],
  ])('%s', (input, id) => {
    expect(parseYouTubeId(input)).toBe(id);
  });
});

describe('parseYouTubeStart', () => {
  it('reads seconds and h/m/s forms', () => {
    expect(parseYouTubeStart('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe(42);
    expect(parseYouTubeStart('https://youtu.be/dQw4w9WgXcQ?t=1m5s')).toBe(65);
    expect(parseYouTubeStart('https://youtu.be/dQw4w9WgXcQ')).toBe(0);
  });
});

describe('cutAction', () => {
  it('jumps over skip ranges, chaining overlaps', () => {
    const cuts = { skip: [{ start: 10, end: 20 }, { start: 19, end: 30 }] };
    expect(cutAction(5, cuts)).toBeNull();
    expect(cutAction(12, cuts)).toEqual({ seek: 30 });
    expect(cutAction(30, cuts)).toBeNull();
  });

  it('plays only the only ranges, then stops', () => {
    const cuts = { only: [{ start: 50, end: 60 }, { start: 10, end: 20 }], skip: [{ start: 0, end: 100 }] };
    expect(cutAction(0, cuts)).toEqual({ seek: 10 });
    expect(cutAction(15, cuts)).toBeNull();
    expect(cutAction(20, cuts)).toEqual({ seek: 50 });
    expect(cutAction(60, cuts)).toEqual({ stop: true });
    expect(cutStart(cuts)).toBe(10);
  });

  it('ignores malformed ranges and missing cuts', () => {
    expect(cutAction(5, null)).toBeNull();
    expect(cutAction(5, { skip: [{ start: 'x', end: 9 }, { start: 8, end: 2 }] })).toBeNull();
    expect(cutStart({ skip: [{ start: 0, end: 7 }] })).toBe(7);
  });
});
