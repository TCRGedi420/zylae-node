// -------------------- Configuration --------------------
const RECOMMENDER_CONFIG = {
  embeddingUrl: '/recs/embeddings.json',
  useClientTraining: false,
  embedDim: 128,
  maxHistory: 200,
  prefetchTopK: 10
};

// -------------------- Anti-Repeat Configuration --------------------
const ANTI_REPEAT_CONFIG = {
  maxHistorySize: 200,
  minHistoryBeforeRepeat: 40,
  enableSmartExclusion: true,
  debugLogging: true
};

// -------------------- History helpers --------------------
let previouslyPlayed = [];
let lastPlayedSongId = null;

function addToHistory(songId) {
  if (!songId) return;
  if (previouslyPlayed.length && previouslyPlayed[previouslyPlayed.length - 1] === songId) return;

  previouslyPlayed.push(songId);

  while (previouslyPlayed.length > ANTI_REPEAT_CONFIG.maxHistorySize) {
    previouslyPlayed.shift();
  }

  if (ANTI_REPEAT_CONFIG.debugLogging) {
    console.log(`📚 Added to history: ${songId}. Total history: ${previouslyPlayed.length}`);
  }
}

function clampHistory() {
  while (previouslyPlayed.length > RECOMMENDER_CONFIG.maxHistory) {
    previouslyPlayed.shift();
  }
}

function canPlaySong(songId) {
  if (!ANTI_REPEAT_CONFIG.enableSmartExclusion) return true;
  if (!songId) return false;

  const idx = previouslyPlayed.indexOf(songId);
  if (idx === -1) return true;

  const songsAgo = previouslyPlayed.length - idx;
  const canPlay = songsAgo >= ANTI_REPEAT_CONFIG.minHistoryBeforeRepeat;

  if (ANTI_REPEAT_CONFIG.debugLogging && !canPlay) {
    console.log(
      `🚫 Song ${songId} too recent (${songsAgo} songs ago, need ${ANTI_REPEAT_CONFIG.minHistoryBeforeRepeat})`
    );
  }

  return canPlay;
}

function getExclusionSet() {
  const excludeIds = new Set();
  if (lastPlayedSongId) excludeIds.add(lastPlayedSongId);
  suggestionState.queue.forEach(id => excludeIds.add(id));
  previouslyPlayed.forEach(id => excludeIds.add(id));
  return excludeIds;
}

// -------------------- State --------------------
window.ZY_SETTINGS = window.ZY_SETTINGS || {
  bitrate: '320kbps',
  autoplay: true
};

let hindiPlayCount = 0;
let teluguPlayCount = 0;
let marathiPlayCount = 0;

let audio = null;
const prelangs = ['malayalam', 'tamil'];
const currentYear = new Date().getFullYear();
const preyears = Array.from({ length: 21 }, (_, i) => (currentYear - i).toString());
const songCache = new Map();

// Suggestion-based autoplay state
const suggestionState = {
  baseSongId: null,
  queue: [],
  index: -1
};

// -------------------- TF.js recommender --------------------
class TfjsRecommender {
  constructor(config = {}) {
    this.embeddingUrl = config.embeddingUrl;
    this.ids = [];
    this.idToIndex = new Map();
    this.embeddings = null;
    this.rawEmbeddings = null;
    this.ready = false;
  }

  async init() {
    if (!window.tf) {
      console.warn('TF.js not found. Recommender disabled. Load https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
      return;
    }
    if (RECOMMENDER_CONFIG.useClientTraining) {
      console.warn('Client-side training enabled - may be slow and memory heavy. Prefer precomputed embeddings.');
      this.ready = false;
      return;
    }

    try {
      const res = await fetch(this.embeddingUrl);
      const json = await res.json();
      if (!json.ids || !json.embeddings) throw new Error('Invalid embeddings JSON');
      this.ids = json.ids;
      json.ids.forEach((id, idx) => this.idToIndex.set(id, idx));
      this.rawEmbeddings = tf.tensor2d(json.embeddings);
      const norms = this.rawEmbeddings.norm('euclidean', 1).expandDims(1);
      this.embeddings = this.rawEmbeddings.div(norms);
      this.ready = true;
      console.log('Recommender loaded:', this.ids.length, 'items');
    } catch (err) {
      console.warn('Failed to load embeddings for recommender:', err);
      this.ready = false;
    }
  }

  async getNearestNeighbors(songId, topK = 20, excludeIds = new Set()) {
    if (!this.ready) return [];
    const idx = this.idToIndex.get(songId);
    if (idx === undefined) return [];

    return tf.tidy(() => {
      const query = this.embeddings.gather([idx]);
      const sims = this.embeddings.matMul(query.transpose()).squeeze();
      const simsArray = sims.arraySync();
      const results = [];
      for (let i = 0; i < simsArray.length; i++) {
        const id = this.ids[i];
        if (id === songId) continue;
        if (excludeIds.has(id)) continue;
        results.push({ id, score: simsArray[i] });
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, topK);
    });
  }

  async recommendNextByEmbedding(currentSongId, excludeIds = new Set(), topK = 10) {
    const neighbors = await this.getNearestNeighbors(currentSongId, topK * 3, excludeIds);
    if (!neighbors || !neighbors.length) return [];
    return neighbors.slice(0, topK).map(n => n.id);
  }
}

const recommender = new TfjsRecommender({
  embeddingUrl: RECOMMENDER_CONFIG.embeddingUrl
});

// -------------------- Helpers --------------------
function decodeHtmlEntities(str) {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function extractSongsFromSearchResponse(json) {
  if (!json) return [];
  if (json.data?.songs) return json.data.songs;
  if (json.data?.results) return json.data.results;
  if (Array.isArray(json.data)) return json.data;
  return json.data || [];
}

function weightedRandomChoice(strategies) {
  const totalWeight = strategies.reduce((acc, s) => acc + s.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const strat of strategies) {
    if (rand < strat.weight) return strat.name;
    rand -= strat.weight;
  }
  return strategies[0].name;
}

// -------------------- Search helpers --------------------
async function searchYearLanguage(year, language, excludeId) {
  const query = `${language} ${year}`;
  const res = await fetch(`/api/search/songs?query=${encodeURIComponent(query)}&limit=50`);
  const json = await res.json();
  return extractSongsFromSearchResponse(json).filter(s => s && s.id !== excludeId);
}

async function searchYearBased(year, language, lastId) {
  const yearNum = parseInt(year, 10) || currentYear;
  let offsets = [];
  if (yearNum === currentYear) offsets = [-3];
  else offsets = [-3, 3];

  const offset = offsets[Math.floor(Math.random() * offsets.length)];
  const targetYear = yearNum + offset;
  console.log(`searchYearBased -> targetYear: ${targetYear} (offset ${offset}) for language: ${language}`);

  let pool = await searchYearLanguage(targetYear, language, lastId);
  if (!pool.length) {
    console.log(`No songs found for ${targetYear} ${language}; falling back to ${language}`);
    const res = await fetch(`/api/search/songs?query=${encodeURIComponent(language)}&limit=50`);
    const json = await res.json();
    pool = extractSongsFromSearchResponse(json).filter(
      s =>
        s &&
        s.id !== lastId &&
        s.language &&
        s.language.toLowerCase() === language.toLowerCase()
    );
  }
  return pool;
}

async function fetchDiverseSong(excludeIds) {
  for (const lang of prelangs) {
    for (const year of preyears) {
      const candidates = await searchYearLanguage(year, lang, null);
      const filtered = candidates.filter(s => s && s.id && !excludeIds.has(s.id));
      if (filtered.length)
        return filtered[Math.floor(Math.random() * filtered.length)];
    }
  }
  return null;
}

async function fetchPopularRandomSong(excludeIds) {
  const res = await fetch(`/api/search/songs?query=${encodeURIComponent('popular')}&limit=50`);
  const json = await res.json();
  const candidates = extractSongsFromSearchResponse(json).filter(
    s => s && s.id && !excludeIds.has(s.id)
  );
  return candidates.length
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : null;
}

// -------------------- Strategy + recommender (used in fallback) --------------------
async function fetchSongsByStrategy(
  strategy,
  { artistIds = [], year, language, excludeId } = {}
) {
  try {
    const excludeIds = getExclusionSet();
    if (recommender.ready && excludeId) {
      const recIds = await recommender.recommendNextByEmbedding(
        excludeId,
        excludeIds,
        RECOMMENDER_CONFIG.prefetchTopK
      );
      if (recIds && recIds.length) {
        const items = [];
        for (const rid of recIds) {
          let s = songCache.get(rid);
          if (!s) {
            const res = await fetch(`/api/songs/${rid}`);
            const json = await res.json();
            s = json.data?.[0];
            if (s) songCache.set(rid, s);
          }
          if (s && !excludeIds.has(s.id)) items.push(s);
        }
        if (items.length) return items;
      }
    }
  } catch (err) {
    console.warn('Recommender fetch failed - falling back to strategy fetch', err);
  }

  switch (strategy) {
    case 'artist':
      if (!artistIds || !artistIds.length) return [];
      {
        const artistId = artistIds[Math.floor(Math.random() * artistIds.length)];
        const res = await fetch(
          `/api/artists/${artistId}/songs?page=0&sortBy=popularity&sortOrder=desc`
        );
        const json = await res.json();
        const excludeIds = getExclusionSet();
        return (json.data?.songs || []).filter(
          s => s && s.id && !excludeIds.has(s.id)
        );
      }
    case 'year':
      if (!year || !language) return [];
      {
        const pool = await searchYearBased(year, language, excludeId);
        const excludeIds = getExclusionSet();
        return pool.filter(s => {
          if (!s || !s.id || excludeIds.has(s.id)) return false;
          if (!s.year) return true;
          const sy = parseInt(s.year) || 0;
          const qy = parseInt(year) || 0;
          return Math.abs(sy - qy) <= 3;
        });
      }
    case 'language':
      if (!language) return [];
      {
        const res = await fetch(
          `/api/search/songs?query=${encodeURIComponent(language)}&limit=50`
        );
        const json = await res.json();
        const excludeIds = getExclusionSet();
        return extractSongsFromSearchResponse(json).filter(
          s =>
            s &&
            s.id &&
            !excludeIds.has(s.id) &&
            s.language &&
            s.language.toLowerCase() === language.toLowerCase()
        );
      }
    default:
      return [];
  }
}

// -------------------- Diversity helper --------------------
function shouldPlayDiverse(currentLang) {
  const lc = (currentLang || '').toLowerCase();
  const overplayedCount =
    lc === 'hindi'
      ? hindiPlayCount
      : lc === 'telugu'
      ? teluguPlayCount
      : lc === 'marathi'
      ? marathiPlayCount
      : 0;
  const threshold = { hindi: 4, telugu: 3, marathi: 3 };
  return overplayedCount >= (threshold[lc] || Infinity);
}

async function fetchDiverseCandidate() {
  const excludeIds = getExclusionSet();

  if (recommender.ready && lastPlayedSongId) {
    const recs = await recommender.getNearestNeighbors(
      lastPlayedSongId,
      30,
      excludeIds
    );
    for (const r of recs) {
      let s = songCache.get(r.id);
      if (!s) {
        const res = await fetch(`/api/songs/${r.id}`);
        const json = await res.json();
        s = json.data?.[0];
        if (s) songCache.set(r.id, s);
      }
      if (s && prelangs.includes((s.language || '').toLowerCase()) && !excludeIds.has(s.id)) {
        return s;
      }
    }
  }

  return await fetchDiverseSong(excludeIds);
}

// -------------------- Suggestions-based autoplay --------------------
async function prefetchSuggestionsFor(songId) {
  try {
    suggestionState.baseSongId = songId;
    suggestionState.queue = [];
    suggestionState.index = -1;

    console.log('🔮 Prefetching suggestions for:', songId);
    const res = await fetch(`/api/songs/${encodeURIComponent(songId)}/suggestions`);
    const json = await res.json();

    const data = json?.data || [];
    if (!Array.isArray(data) || !data.length) {
      console.warn('No suggestions returned, triggering fallback.');
      await fallbackFreshSongsWithExclusion();
      return;
    }

    const excludeIds = getExclusionSet();
    const ids = data
      .map(s => s.id)
      .filter(id => id && !excludeIds.has(id));

    suggestionState.queue = ids;
    suggestionState.index = -1;

    console.log('📋 Suggestion queue prepared:', suggestionState.queue.length, 'items');
  } catch (err) {
    console.warn('Suggestion fetch failed, using fallback:', err);
    await fallbackFreshSongsWithExclusion();
  }
}

async function playNextFromSuggestions() {
  // 1) Use existing queue
  if (
    suggestionState.queue.length &&
    suggestionState.index < suggestionState.queue.length - 1
  ) {
    suggestionState.index += 1;
    const nextId = suggestionState.queue[suggestionState.index];

    if (!canPlaySong(nextId)) {
      console.log('Skipping too-recent suggestion:', nextId);
      return playNextFromSuggestions();
    }

    console.log('▶️ Autoplay from suggestions →', nextId);
    await playSong(nextId, { fromAutoplay: true });

    suggestionState.baseSongId =
      suggestionState.queue[suggestionState.queue.length - 1] || nextId;
    return;
  }

  // 2) Need new suggestions
  const baseId =
    (suggestionState.queue.length
      ? suggestionState.queue[suggestionState.queue.length - 1]
      : null) ||
    lastPlayedSongId ||
    (previouslyPlayed.length ? previouslyPlayed[previouslyPlayed.length - 1] : null) ||
    suggestionState.baseSongId;

  if (!baseId) {
    console.warn('No base song ID for new suggestions; using fallback fresh songs.');
    await fallbackFreshSongsWithExclusion();
    return;
  }

  await prefetchSuggestionsFor(baseId);

  if (suggestionState.queue.length) {
    suggestionState.index = 0;
    const nextId = suggestionState.queue[0];
    if (!canPlaySong(nextId)) {
      console.log('Skipping too-recent suggestion:', nextId);
      return playNextFromSuggestions();
    }
    console.log('▶️ Autoplay from new suggestions →', nextId);
    await playSong(nextId, { fromAutoplay: true });
    return;
  }

  await fallbackFreshSongsWithExclusion();
}

// Fallback: try to get fresh songs with exclusion
async function fallbackFreshSongsWithExclusion() {
  try {
    console.warn('⚠️ Running fallbackFreshSongsWithExclusion');
    const excludeIds = getExclusionSet();

    const baseId =
      lastPlayedSongId ||
      (previouslyPlayed.length ? previouslyPlayed[previouslyPlayed.length - 1] : null);

    if (!baseId) {
      console.warn('No base ID for fallback; trying popular random song.');
      const cand = await fetchPopularRandomSong(excludeIds);
      if (cand && cand.id) {
        console.log('🎯 Fallback popular playing:', cand.name);
        await playSong(cand.id, { fromAutoplay: true });
      } else {
        console.warn('No fallback candidate found at all.');
      }
      return;
    }

    let s = songCache.get(baseId);
    if (!s) {
      const res = await fetch(`/api/songs/${baseId}`);
      const json = await res.json();
      s = json.data?.[0];
      if (s) songCache.set(baseId, s);
    }

    const qLang = s?.language || '';
    const qYear = s?.year || '';
    let queryStr = qLang;
    if (qLang && qYear) queryStr = `${qLang} ${qYear}`;

    const fallbackRes = await fetch(
      `/api/search/songs?query=${encodeURIComponent(queryStr)}&limit=40`
    );
    const fallbackJson = await fallbackRes.json();
    let candidates = extractSongsFromSearchResponse(fallbackJson);

    if (candidates && candidates.length > 0) {
      const freshCandidates = candidates.filter(
        song => song && song.id && !excludeIds.has(song.id)
      );

      if (freshCandidates.length > 0) {
        const fallbackSong =
          freshCandidates[Math.floor(Math.random() * freshCandidates.length)];
        console.log('🎯 Fallback playing:', fallbackSong.name);
        await playSong(fallbackSong.id, { fromAutoplay: true });
        return;
      }
    }

    console.warn('No fresh fallback candidates; trying popular with global exclusion.');
    const popular = await fetchPopularRandomSong(excludeIds);
    if (popular && popular.id) {
      console.log('🎯 Fallback popular playing:', popular.name);
      await playSong(popular.id, { fromAutoplay: true });
      return;
    }

    console.warn('❌ No popular fallback available; clearing history to break potential loop.');
    previouslyPlayed = [];
    suggestionState.queue = [];
    suggestionState.index = -1;
  } catch (err) {
    console.error('❌ Fallback failed:', err);
  }
}

// -------------------- onEnded handler --------------------
async function onEnded() {
  try {
    console.log('🎵 Song ended.');

    if (window.ZY_SETTINGS && window.ZY_SETTINGS.autoplay === false) {
      console.log('🔕 Autoplay disabled in settings; stopping after this track.');
      return;
    }

    await playNextFromSuggestions();
  } catch (err) {
    console.error('❌ Autoplay failed:', err);
  }
}

// -------------------- Play song (core) --------------------
async function playSong(id, options = {}) {
  const { fromAutoplay = false, fromHistory = false } = options;

  try {
    if (!fromHistory && lastPlayedSongId && lastPlayedSongId !== id) {
      addToHistory(lastPlayedSongId);
      clampHistory();
    }

    let s = songCache.get(id);
    if (!s) {
      const res = await fetch(`/api/songs/${id}`);
      const json = await res.json();
      s = json.data?.[0];
      if (!s) throw new Error('Song metadata not found');
      songCache.set(id, s);
    }

    lastPlayedSongId = id;

    if (!fromAutoplay && !fromHistory) {
      suggestionState.baseSongId = id;
      suggestionState.queue = [];
      suggestionState.index = -1;

      prefetchSuggestionsFor(id).catch(err =>
        console.warn('Failed to prefetch suggestions:', err)
      );
    }

    const lang = (s.language || '').toLowerCase();
    if (lang === 'hindi') hindiPlayCount++;
    else hindiPlayCount = 0;

    if (lang === 'telugu') teluguPlayCount++;
    else teluguPlayCount = 0;

    if (lang === 'marathi') marathiPlayCount++;
    else marathiPlayCount = 0;

    console.log('Song Data:', s);
    if (ANTI_REPEAT_CONFIG.debugLogging) {
      console.log(`🎵 Playing: ${s.name} (${s.language} ${s.year}) - ID: ${id}`);
    }

    const desiredQuality = window.ZY_SETTINGS?.bitrate || '320kbps';
    const urlObj =
      s.downloadUrl?.find(d => d.quality === desiredQuality) ||
      s.downloadUrl?.slice(-1)[0];

    const url = urlObj?.url;
    if (!url) throw new Error('Audio URL not found');

    audio.src = url;
    try {
      await audio.play();
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Play failed:', err);
    }

    updateNowPlayingUI(s);
  } catch (err) {
    console.error('❌ Failed to load song:', err);
  }
}

// Highest quality thumbnail for bar image
function updateNowPlayingUI(s) {
  const primaryArtistNames = (s.artists?.primary || []).map(artist => artist.name);
  const featuredArtistNames = (s.artists?.featured || []).map(artist => artist.name);
  const allArtistsOrdered = [...primaryArtistNames, ...featuredArtistNames];

  const images = Array.isArray(s.image) ? s.image : [];
  const art = images.length ? images[images.length - 1].url : '';

  document.getElementById('np-art').src = art;
  document.getElementById('np-title').textContent = decodeHtmlEntities(s.name || '');
  document.getElementById('np-artist').textContent = allArtistsOrdered.join(', ');
  document.getElementById('now-playing-bar').classList.remove('hidden');

  // 🟢 Media Session API: notification/lockscreen info + controls
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: decodeHtmlEntities(s.name || ''),
      artist: allArtistsOrdered.join(', '),
      album: s.album?.name || s.album || '',
      artwork: images.map(img => ({
        src: img.url,
        sizes: img.quality || '512x512',
        type: 'image/jpeg'
      }))
    });

    // Update playback state
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';

    // Action handlers (tie into your existing functions)
    navigator.mediaSession.setActionHandler('play', () => {
      audio.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (previouslyPlayed.length > 0) {
        const prevId = previouslyPlayed.pop();
        playSong(prevId, { fromHistory: true });
      }
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNextFromSuggestions().catch(err => {
        console.error('MediaSession nexttrack failed:', err);
      });
    });
  }

  const playPauseBtn = document.getElementById('np-play-pause');
  let paused = false;
  playPauseBtn.innerHTML = `<i class="fas fa-pause"></i>`;
  playPauseBtn.onclick = () => {
    paused = !paused;
    paused ? audio.pause() : audio.play();
    playPauseBtn.innerHTML = paused
      ? `<i class="fas fa-play"></i>`
      : `<i class="fas fa-pause"></i>`;
  };

  const seekbar = document.getElementById('np-seekbar');
  function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  audio.ontimeupdate = () => {
    seekbar.value = (audio.currentTime / audio.duration) * 100 || 0;
    document.getElementById('np-time').textContent = `${formatTime(
      audio.currentTime
    )} / ${formatTime(audio.duration)}`;
  };
  seekbar.oninput = () => {
    audio.currentTime = (seekbar.value / 100) * audio.duration;
  };
}

function resetLanguageCounts() {
  hindiPlayCount = teluguPlayCount = marathiPlayCount = 0;
}

// -------------------- DOM Ready wiring --------------------
document.addEventListener('DOMContentLoaded', async () => {
  audio = document.getElementById('audio-player');

  recommender.init();

  if (audio) audio.addEventListener('ended', onEnded);

  const nextBtn = document.getElementById('np-next');
  if (nextBtn)
    nextBtn.addEventListener('click', async () => {
      try {
        await playNextFromSuggestions();
      } catch (err) {
        console.error('⏭️ Next button failed:', err);
        audio.dispatchEvent(new Event('ended'));
      }
    });

  const prevBtn = document.getElementById('np-prev');
  if (prevBtn)
    prevBtn.addEventListener('click', () => {
      if (previouslyPlayed.length > 0) {
        const prevSongId = previouslyPlayed.pop();
        console.log('🔙 Going back to:', prevSongId);
        playSong(prevSongId, { fromHistory: true });
      } else {
        console.warn('🔙 No previous song in history.');
      }
    });
});

// -------------------- Export for debugging --------------------
window._player = {
  playSong,
  onEnded,
  recommender,
  songCache,
  previouslyPlayed,
  getLastPlayed: () => lastPlayedSongId
};
