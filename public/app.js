// public/app.js

// ---- Global settings object shared with player.js ----
window.ZY_SETTINGS = window.ZY_SETTINGS || {
  bitrate: '320kbps',
  autoplay: true,
  downloadsEnabled: true,
  theme: 'dark',
  saveVolume: true,
  viewportMode: 'default'
};

// Helpers
function $(selector) {
  return document.querySelector(selector);
}
function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function applyViewportFromSettings() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;

  const mode = (window.ZY_SETTINGS.viewportMode || 'default').toLowerCase();
  let content;

  switch (mode) {
    case 'android-phone':
      // Approx typical Android phone width
      content = 'width=360, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover';
      break;
    case 'ios-phone':
      // Approx iPhone 13/14 width
      content = 'width=390, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover';
      break;
    case 'android-tv':
      content = 'width=1280, initial-scale=1.0, maximum-scale=1.0';
      break;
    case 'desktop-wide':
      content = 'width=1440, initial-scale=1.0, maximum-scale=1.0';
      break;
    default:
      content = 'width=device-width, initial-scale=1.0';
  }

  meta.setAttribute('content', content);
}

document.addEventListener('DOMContentLoaded', () => {
  // Layout elements
  const sidebar = $('#sidebar');
  const sidebarToggle = $('#sidebar-toggle');
  const mobileSidebarToggle = $('#mobile-sidebar-toggle');
  const breadcrumbs = $('.breadcrumbs');

  const views = $all('.view');
  const navItems = $all('.nav-item');

  // Search elements
  const quickSearchForm = $('#quick-search-form');
  const quickSearchInput = $('#quick-search-input');
  const searchForm = $('#search-form');
  const searchInput = $('#search-input');
  const searchStatus = $('#search-status');
  const searchResults = $('#search-results');

  // Settings elements
  const bitrateSelect = $('#bitrate-select');
  const downloadsEnable = $('#downloads-enable');
  const autoplayToggle = $('#autoplay-toggle');
  const saveVolumeToggle = $('#save-volume-toggle');
  const themeToggle = $('#theme-toggle');
  const themeRadioInputs = $all('input[name="theme-mode"]');
  const viewportSelect = $('#viewport-select');

  // Player related DOM
  const nowPlayingBar = $('#now-playing-bar');
  const npClickOverlay = $('#np-click-overlay');

  const npFs = $('#np-fullscreen');
  const npFsArt = $('#np-fs-art');
  const npFsTitle = $('#np-fs-title');
  const npFsArtist = $('#np-fs-artist');
  const npFsAlbum = $('#np-fs-album');
  const npFsClose = $('#np-fullscreen-close');
  const npFsPrev = $('#np-fs-prev');
  const npFsNext = $('#np-fs-next');
  const npFsPlayPause = $('#np-fs-play-pause');

  const audioEl = $('#audio-player');
  const recentlyPlayedList = $('#recently-played-list');

  // ------------- SPA View handling -------------
  function setActiveView(viewId) {
    views.forEach(v => v.classList.toggle('active', v.id === `view-${viewId}`));
    navItems.forEach(btn =>
      btn.classList.toggle('active', btn.dataset.view === viewId)
    );
    breadcrumbs.textContent =
      viewId.charAt(0).toUpperCase() + viewId.slice(1).toLowerCase();
  }

  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveView(btn.dataset.view);
    });
  });

  // ------------- Sidebar toggles -------------
  sidebarToggle?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  mobileSidebarToggle?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  // ------------- Settings: load + apply -------------
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('zylaeSettings') || '{}');
      Object.assign(window.ZY_SETTINGS, saved);
    } catch (e) {
      console.warn('Failed to parse settings, using defaults');
    }
  }
  function persistSettings() {
    localStorage.setItem('zylaeSettings', JSON.stringify(window.ZY_SETTINGS));
  }

  function applyTheme() {
    const theme = window.ZY_SETTINGS.theme || 'dark';
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    // Toggle button text/icon
    themeToggle.querySelector('span').textContent =
      theme === 'dark' ? 'Dark' : 'Light';
    themeToggle.querySelector('i').className =
      theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  }

  function applySettingsToUI() {
    bitrateSelect.value = window.ZY_SETTINGS.bitrate || '320kbps';
    downloadsEnable.checked = !!window.ZY_SETTINGS.downloadsEnabled;
    autoplayToggle.checked = !!window.ZY_SETTINGS.autoplay;
    saveVolumeToggle.checked = !!window.ZY_SETTINGS.saveVolume;

    themeRadioInputs.forEach(r => {
      r.checked = r.value === (window.ZY_SETTINGS.theme || 'dark');
    });

    if (viewportSelect) {
      viewportSelect.value = window.ZY_SETTINGS.viewportMode || 'default';
    }

    applyTheme();

    if (audioEl && window.ZY_SETTINGS.saveVolume && window.ZY_SETTINGS.volume != null) {
      audioEl.volume = window.ZY_SETTINGS.volume;
    }
  }

  // Load settings and apply viewport *before* we render too much
  loadSettings();
  applyViewportFromSettings();
  applySettingsToUI();

  // Settings: listeners
  bitrateSelect.addEventListener('change', () => {
    window.ZY_SETTINGS.bitrate = bitrateSelect.value;
    persistSettings();
  });

  downloadsEnable.addEventListener('change', () => {
    window.ZY_SETTINGS.downloadsEnabled = downloadsEnable.checked;
    persistSettings();
  });

  autoplayToggle.addEventListener('change', () => {
    window.ZY_SETTINGS.autoplay = autoplayToggle.checked;
    persistSettings();
  });

  saveVolumeToggle.addEventListener('change', () => {
    window.ZY_SETTINGS.saveVolume = saveVolumeToggle.checked;
    persistSettings();
  });

  if (viewportSelect) {
    viewportSelect.addEventListener('change', () => {
      const newMode = viewportSelect.value;
      const currentMode = window.ZY_SETTINGS.viewportMode || 'default';
      if (newMode === currentMode) return;

      const ok = window.confirm(
        'After modifying this setting, the page should be reloaded to take effect.'
      );
      if (!ok) {
        viewportSelect.value = currentMode;
        return;
      }

      window.ZY_SETTINGS.viewportMode = newMode;
      persistSettings();
      // Reload to "starting page" with new viewport applied
      window.location.href = '/';
    });
  }

  themeRadioInputs.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        window.ZY_SETTINGS.theme = radio.value;
        applyTheme();
        persistSettings();
      }
    });
  });

  themeToggle.addEventListener('click', () => {
    const newTheme =
      (window.ZY_SETTINGS.theme || 'dark') === 'dark' ? 'light' : 'dark';
    window.ZY_SETTINGS.theme = newTheme;
    applyTheme();
    themeRadioInputs.forEach(r => (r.checked = r.value === newTheme));
    persistSettings();
  });

  // Volume persistence
  if (audioEl) {
    audioEl.addEventListener('volumechange', () => {
      if (!window.ZY_SETTINGS.saveVolume) return;
      window.ZY_SETTINGS.volume = audioEl.volume;
      persistSettings();
    });
  }

  // ------------- Search -------------
  async function searchSongs(query) {
    if (!query || !query.trim()) return;

    setActiveView('search');
    searchInput.value = query;
    searchStatus.textContent = 'Searching…';
    searchResults.innerHTML = '';

    try {
      const res = await fetch(
        `/api/search/songs?query=${encodeURIComponent(query)}&limit=20`
      );
      const json = await res.json();

      const songs =
        json?.data?.songs ||
        json?.data?.results ||
        (Array.isArray(json?.data) ? json.data : json.data || []);

      if (!songs || !songs.length) {
        searchStatus.textContent = 'No songs found. Try another term.';
        return;
      }

      searchStatus.textContent = `${songs.length} song(s) found`;

      searchResults.innerHTML = '';
      songs.forEach((song) => {
        const item = document.createElement('div');
        item.className = 'result-item';

        const art = document.createElement('img');
        art.className = 'result-art';
        art.src = song.image?.[1]?.url || song.image?.[0]?.url || '';
        art.alt = song.name || '';

        const main = document.createElement('div');
        main.className = 'result-main';

        const text = document.createElement('div');
        text.className = 'result-text';

        const title = document.createElement('div');
        title.className = 'result-title';
        title.textContent = song.name || '';

        const artistNames = (song.artists?.primary || []).map(a => a.name).join(', ');
        const albumName = song.album?.name || song.album || '';

        const sub = document.createElement('div');
        sub.className = 'result-sub';
        sub.textContent = [artistNames, albumName].filter(Boolean).join(' • ');

        text.appendChild(title);
        text.appendChild(sub);
        main.appendChild(art);
        main.appendChild(text);

        const actions = document.createElement('div');
        actions.className = 'result-actions';

        const playBtn = document.createElement('button');
        playBtn.className = 'icon-button';
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
        playBtn.title = 'Play';

        playBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (window._player && typeof window._player.playSong === 'function') {
            window._player.playSong(song.id);
          } else {
            console.warn('Player not ready');
          }
        });

        const dlBtn = document.createElement('button');
        dlBtn.className = 'icon-button';
        dlBtn.innerHTML = '<i class="fas fa-download"></i>';
        dlBtn.title = 'Download';

        dlBtn.addEventListener('click', async e => {
          e.stopPropagation();
          if (!window.ZY_SETTINGS.downloadsEnabled) return;

          const q = window.ZY_SETTINGS.bitrate || '320kbps';
          const url = `/api/download/${encodeURIComponent(
            song.id
          )}?quality=${encodeURIComponent(q)}`;
          window.open(url, '_blank');
        });

        actions.appendChild(playBtn);
        actions.appendChild(dlBtn);

        item.appendChild(main);
        item.appendChild(actions);

        searchResults.appendChild(item);
      });
    } catch (err) {
      console.error('Search error:', err);
      searchStatus.textContent = 'Something went wrong while searching.';
    }
  }

  // Search forms
  quickSearchForm?.addEventListener('submit', e => {
    e.preventDefault();
    searchSongs(quickSearchInput.value);
  });

  searchForm?.addEventListener('submit', e => {
    e.preventDefault();
    searchSongs(searchInput.value);
  });

  // ------------- Fullscreen Now Playing -------------
  function updateFullscreenFromBar() {
    const barTitle = $('#np-title')?.textContent || '';
    const barArtist = $('#np-artist')?.textContent || '';
    const barArt = $('#np-art')?.getAttribute('src') || '';

    npFsArt.src = barArt || '';
    npFsTitle.textContent = barTitle || '–';
    npFsArtist.textContent = barArtist || '–';

    if (window._player && window._player.songCache && window._player.previouslyPlayed) {
      try {
        const hist = window._player.previouslyPlayed;
        const lastId =
          hist && hist.length
            ? hist[hist.length - 1]
            : window._player.getLastPlayed
            ? window._player.getLastPlayed()
            : null;
        const maybeSong = lastId ? window._player.songCache.get(lastId) : null;
        const albumName = maybeSong?.album?.name || maybeSong?.album || '';
        npFsAlbum.textContent = albumName || '';
      } catch (_) {
        npFsAlbum.textContent = '';
      }
    }
  }

  function openFullscreenNP() {
    updateFullscreenFromBar();
    npFs.classList.remove('hidden');
  }

  function closeFullscreenNP() {
    npFs.classList.add('hidden');
  }

  if (npClickOverlay) {
    npClickOverlay.addEventListener('click', () => {
      if (nowPlayingBar.classList.contains('hidden')) return;
      openFullscreenNP();
    });
  }

  npFsClose?.addEventListener('click', closeFullscreenNP);
  npFs.addEventListener('click', e => {
    if (e.target === npFs) closeFullscreenNP();
  });

  const npPrev = $('#np-prev');
  const npNext = $('#np-next');
  const npPlayPause = $('#np-play-pause');

  npFsPrev?.addEventListener('click', () => npPrev?.click());
  npFsNext?.addEventListener('click', () => npNext?.click());
  npFsPlayPause?.addEventListener('click', () => npPlayPause?.click());

  // ------------- Recently Played (from player history) -------------
  function refreshRecentlyPlayed() {
    if (!window._player || !Array.isArray(window._player.previouslyPlayed)) return;
    const ids = [...window._player.previouslyPlayed].slice(-8).reverse();
    recentlyPlayedList.innerHTML = '';
    ids.forEach(id => {
      const li = document.createElement('li');
      li.textContent = id;
      recentlyPlayedList.appendChild(li);
    });
  }

  let attempts = 0;
  const pollInterval = setInterval(() => {
    attempts++;
    if (window._player && window._player.previouslyPlayed) {
      clearInterval(pollInterval);
      setInterval(refreshRecentlyPlayed, 4000);
    }
    if (attempts > 20) clearInterval(pollInterval);
  }, 500);

  // Default view
  setActiveView('home');
});
