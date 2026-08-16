const elements = {
  form: document.querySelector('#search-form'),
  grid: document.querySelector('#anime-grid'),
  empty: document.querySelector('#empty-state'),
  label: document.querySelector('#results-label'),
  live: document.querySelector('#live-state'),
  loadMore: document.querySelector('#load-more'),
  posters: document.querySelector('#hero-posters'),
  dialog: document.querySelector('#detail-dialog'),
  dialogContent: document.querySelector('#detail-content'),
  dialogClose: document.querySelector('#dialog-close'),
  toast: document.querySelector('#toast')
};

const state = { cursor: null, loading: false, filters: { search: '', type: '0', sort: 'added-desc' } };
const svgPlaceholder = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><rect width="300" height="450" fill="#1b2030"/><path d="M85 176h130v98H85z" fill="#252b3d"/><circle cx="150" cy="225" r="27" fill="#ff725e" opacity=".5"/></svg>')}`;

const api = async (path) => {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.error?.message || `Request failed with HTTP ${response.status}`);
  return payload;
};

const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = value ?? '';
  if (className) node.className = className;
  return node;
};

const setConnected = (mode, label) => {
  elements.live.className = `live-state ${mode}`;
  elements.live.innerHTML = '<span></span>';
  elements.live.append(document.createTextNode(label));
};

const showToast = (message) => {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
};

const animeCard = (anime) => {
  const article = document.createElement('article');
  article.className = 'anime-card';
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', `View details for ${anime.title}`);
  button.addEventListener('click', () => openDetails(anime.id));

  const imageBox = document.createElement('div');
  imageBox.className = 'card-image';
  const image = new Image();
  image.src = anime.cover || svgPlaceholder;
  image.alt = `${anime.title} cover`;
  image.loading = 'lazy';
  image.width = 300;
  image.height = 420;
  image.addEventListener('error', () => { image.src = svgPlaceholder; }, { once: true });
  imageBox.append(image);
  if (anime.status) imageBox.append(text('span', anime.status, 'card-status'));

  const body = document.createElement('div');
  body.className = 'card-body';
  body.append(text('h3', anime.title));
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.append(text('span', anime.type || 'Unknown'), document.createElement('i'), text('span', anime.year || 'TBA'));
  if (anime.episodeCount != null) meta.append(document.createElement('i'), text('span', `${anime.episodeCount} eps`));
  body.append(meta);

  const tags = document.createElement('div');
  tags.className = 'card-tags';
  (anime.tags || []).slice(0, 3).forEach((tag) => tags.append(text('span', tag.name, 'tag')));
  body.append(tags);
  button.append(imageBox, body);
  article.append(button);
  return article;
};

const renderAnime = (items, append = false) => {
  if (!append) elements.grid.replaceChildren();
  items.forEach((anime) => elements.grid.append(animeCard(anime)));
  elements.grid.setAttribute('aria-busy', 'false');
  elements.empty.hidden = elements.grid.children.length > 0;
};

const showSkeletons = () => {
  elements.grid.setAttribute('aria-busy', 'true');
  elements.grid.replaceChildren(...Array.from({ length: 4 }, () => {
    const card = document.createElement('div');
    card.className = 'anime-card skeleton-card';
    return card;
  }));
  elements.empty.hidden = true;
};

const catalogPath = (cursor = '') => {
  const query = new URLSearchParams();
  const search = state.filters.search ? state.filters.search.trim() : '';
  if (search.startsWith('anilist:') || /^\d+$/.test(search)) {
    query.set('anilistId', search.replace(/^anilist:/i, '').trim());
  } else if (search) {
    query.set('search', search);
  }
  if (state.filters.sort) query.set('sort', state.filters.sort);
  if (state.filters.type) query.set('type', state.filters.type);
  if (cursor) query.set('cursor', cursor);
  return `/api/v1/anime?${query}`;
};

const loadCatalog = async ({ append = false } = {}) => {
  if (state.loading) return;
  state.loading = true;
  elements.loadMore.disabled = true;
  if (!append) showSkeletons();
  setConnected('', 'Requesting');
  try {
    const payload = await api(catalogPath(append ? state.cursor : ''));
    renderAnime(payload.data.items, append);
    state.cursor = payload.data.nextCursor;
    elements.loadMore.hidden = !payload.data.hasMore || !state.cursor;
    elements.loadMore.disabled = false;
    const count = elements.grid.children.length;
    elements.label.textContent = state.filters.search ? `${count} result${count === 1 ? '' : 's'} for “${state.filters.search}”` : `${count} recent additions`;
    setConnected('connected', `${payload.meta.cache} · ${payload.meta.responseTimeMs}ms`);
  } catch (error) {
    if (!append) renderAnime([]);
    setConnected('failed', 'Unavailable');
    showToast(error.message);
  } finally {
    state.loading = false;
  }
};

const renderHeroPosters = (items) => {
  const choices = items.filter((anime) => anime.cover).slice(0, 3);
  if (!choices.length) return;
  elements.posters.replaceChildren();
  choices.forEach((anime, index) => {
    const card = document.createElement('div');
    card.className = `poster poster-${String.fromCharCode(97 + index)}`;
    const image = new Image();
    image.src = anime.cover;
    image.alt = `${anime.title} cover`;
    image.width = 218;
    image.height = 327;
    card.append(image);
    elements.posters.append(card);
  });
};

const loadHome = async () => {
  try {
    const payload = await api('/api/v1/home');
    renderHeroPosters(payload.data.latestAnime);
    const lightweight = payload.data.latestAnime.map((anime) => ({ ...anime, status: 'New', tags: [] }));
    renderAnime(lightweight);
    elements.label.textContent = `${lightweight.length} latest additions`;
    setConnected('connected', `${payload.meta.cache} · ${payload.meta.responseTimeMs}ms`);
  } catch {
    await loadCatalog();
  }
};

const episodeRow = (episode, animeId) => {
  const row = document.createElement('div');
  row.className = 'episode-row';
  row.append(text('span', episode.number, 'episode-number'));
  const titleBox = document.createElement('span');
  titleBox.append(text('strong', episode.title || `Episode ${episode.number}`));
  if (episode.summary) titleBox.append(text('small', episode.summary));
  
  const rightBox = document.createElement('div');
  rightBox.className = 'episode-meta-group';
  if (episode.date || episode.duration) {
    rightBox.append(text('small', episode.date || episode.duration || '', 'episode-meta-text'));
  }

  const streamBtn = document.createElement('button');
  streamBtn.type = 'button';
  streamBtn.className = 'stream-badge-btn';
  streamBtn.title = 'View HLS stream endpoint';
  streamBtn.textContent = 'HLS Stream';
  streamBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openStreamInfo(episode.animeId || animeId, episode.number);
  });
  rightBox.append(streamBtn);

  row.append(titleBox, rightBox);
  return row;
};

const renderStreamModal = (stream) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'stream-detail';

  const heading = document.createElement('div');
  heading.className = 'stream-header';
  heading.append(text('span', `${stream.animeTitle || 'Anime'} · Ep ${stream.episodeNumber}`, 'kicker'));
  heading.append(text('h2', stream.title || `Episode ${stream.episodeNumber}`));
  wrapper.append(heading);

  const card = document.createElement('div');
  card.className = 'stream-info-card';

  const masterRow = document.createElement('div');
  masterRow.className = 'stream-field';
  masterRow.append(text('label', 'HLS Master Playlist'));
  const masterBox = document.createElement('div');
  masterBox.className = 'stream-input-group';
  const masterInput = document.createElement('input');
  masterInput.type = 'text';
  masterInput.readOnly = true;
  masterInput.value = stream.hls?.url || '';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'button button-ghost button-sm';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(masterInput.value).catch(() => {});
    showToast('HLS URL copied!');
  });
  masterBox.append(masterInput, copyBtn);
  masterRow.append(masterBox);
  card.append(masterRow);

  if (stream.hls?.proxyUrl) {
    const proxyRow = document.createElement('div');
    proxyRow.className = 'stream-field';
    proxyRow.append(text('label', 'CORS Playback / Proxy URL'));
    const proxyBox = document.createElement('div');
    proxyBox.className = 'stream-input-group';
    const proxyInput = document.createElement('input');
    proxyInput.type = 'text';
    proxyInput.readOnly = true;
    proxyInput.value = new URL(stream.hls.proxyUrl, window.location.origin).toString();
    const copyProxyBtn = document.createElement('button');
    copyProxyBtn.type = 'button';
    copyProxyBtn.className = 'button button-ghost button-sm';
    copyProxyBtn.textContent = 'Copy';
    copyProxyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(proxyInput.value).catch(() => {});
      showToast('Proxy URL copied!');
    });
    proxyBox.append(proxyInput, copyProxyBtn);
    proxyRow.append(proxyBox);
    card.append(proxyRow);
  }

  const badges = document.createElement('div');
  badges.className = 'stream-badges';
  if (stream.anilistId) {
    const anilistTag = document.createElement('a');
    anilistTag.className = 'tag tag-link';
    anilistTag.href = `https://anilist.co/anime/${stream.anilistId}`;
    anilistTag.target = '_blank';
    anilistTag.rel = 'noopener noreferrer';
    anilistTag.textContent = `AniList #${stream.anilistId} ↗`;
    badges.append(anilistTag);
  }
  if (stream.duration) badges.append(text('span', `Duration: ${stream.duration}`, 'tag'));
  if (stream.hls?.subtitles?.length) badges.append(text('span', `${stream.hls.subtitles.length} Subtitles`, 'tag'));
  if (stream.servers?.length) badges.append(text('span', `${stream.servers.length} Servers`, 'tag'));
  card.append(badges);

  const actions = document.createElement('div');
  actions.className = 'stream-actions';
  const apiLink = document.createElement('a');
  apiLink.className = 'button button-primary button-sm';
  apiLink.href = `/api/v1/anime/${encodeURIComponent(stream.animeId)}/episodes/${encodeURIComponent(stream.episodeNumber)}/stream`;
  apiLink.target = '_blank';
  apiLink.rel = 'noopener noreferrer';
  apiLink.textContent = 'Open Stream API JSON';
  actions.append(apiLink);
  card.append(actions);

  wrapper.append(card);
  return wrapper;
};

async function openStreamInfo(animeId, episodeNumber) {
  elements.dialogContent.innerHTML = '<div class="dialog-loading"><div class="spinner" aria-label="Loading stream details"></div></div>';
  elements.dialog.showModal();
  try {
    const payload = await api(`/api/v1/anime/${encodeURIComponent(animeId)}/episodes/${encodeURIComponent(episodeNumber)}/stream`);
    elements.dialogContent.replaceChildren(renderStreamModal(payload.data));
  } catch (error) {
    elements.dialogContent.replaceChildren(text('div', error.message, 'dialog-loading'));
  }
}

const renderDetails = (anime) => {
  const wrapper = document.createElement('div');
  const hero = document.createElement('div');
  hero.className = 'detail-hero';
  const backdrop = new Image();
  backdrop.className = 'detail-backdrop';
  backdrop.src = anime.banner || anime.cover || svgPlaceholder;
  backdrop.alt = '';
  const header = document.createElement('div');
  header.className = 'detail-header';
  const cover = new Image();
  cover.className = 'detail-cover';
  cover.src = anime.cover || svgPlaceholder;
  cover.alt = `${anime.title} cover`;
  const copy = document.createElement('div');
  copy.append(text('span', anime.status || 'Unknown', 'kicker'), text('h2', anime.title));
  copy.querySelector('h2').id = 'detail-title';
  copy.append(text('p', [anime.type, anime.year, anime.episodeCount != null ? `${anime.episodeCount} episodes` : null].filter(Boolean).join(' · ')));
  header.append(cover, copy);
  hero.append(backdrop, header);

  const body = document.createElement('div');
  body.className = 'detail-body';

  if (anime.anilist) {
    const anilistBox = document.createElement('div');
    anilistBox.className = 'anilist-reference-card';

    const anilistHeader = document.createElement('div');
    anilistHeader.className = 'anilist-reference-header';
    anilistHeader.append(
      text('strong', `AniList #${anime.anilist.id}`),
      text('span', `${anime.anilist.matchScore}% Match (${anime.anilist.confidence})`, `match-badge match-${anime.anilist.confidence}`)
    );

    const anilistMeta = document.createElement('div');
    anilistMeta.className = 'anilist-reference-meta';
    if (anime.anilist.averageScore) {
      anilistMeta.append(text('span', `★ ${anime.anilist.averageScore}% Score`, 'tag'));
    }
    if (anime.anilist.seasonYear) {
      anilistMeta.append(text('span', `Year: ${anime.anilist.seasonYear}`, 'tag'));
    }
    if (anime.anilist.format) {
      anilistMeta.append(text('span', `Format: ${anime.anilist.format}`, 'tag'));
    }

    const anilistLink = document.createElement('a');
    anilistLink.className = 'button button-ghost button-sm';
    anilistLink.href = anime.anilist.siteUrl || `https://anilist.co/anime/${anime.anilist.id}`;
    anilistLink.target = '_blank';
    anilistLink.rel = 'noopener noreferrer';
    anilistLink.textContent = 'View on AniList ↗';

    anilistBox.append(anilistHeader, anilistMeta, anilistLink);
    body.append(anilistBox);
  }

  body.append(text('p', anime.synopsis || 'No synopsis is currently available.'));
  const tags = document.createElement('div');
  tags.className = 'detail-tags';
  (anime.tags || []).forEach((tag) => tags.append(text('span', tag.name, 'tag')));
  body.append(tags);
  if (anime.episodes?.length) {
    body.append(text('h3', `Episodes · ${anime.episodes.length}`));
    const list = document.createElement('div');
    list.className = 'episode-list';
    anime.episodes.forEach((episode) => list.append(episodeRow(episode, anime.id)));
    body.append(list);
  }
  wrapper.append(hero, body);
  return wrapper;
};

async function openDetails(id) {
  elements.dialogContent.innerHTML = '<div class="dialog-loading"><div class="spinner" aria-label="Loading details"></div></div>';
  elements.dialog.showModal();
  try {
    const payload = await api(`/api/v1/anime/${encodeURIComponent(id)}`);
    elements.dialogContent.replaceChildren(renderDetails(payload.data));
  } catch (error) {
    elements.dialogContent.replaceChildren(text('div', error.message, 'dialog-loading'));
  }
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData(elements.form);
  state.filters = {
    search: String(values.get('search') || '').trim(),
    type: String(values.get('type') || '0'),
    sort: String(values.get('sort') || 'added-desc')
  };
  state.cursor = null;
  loadCatalog();
});

elements.loadMore.addEventListener('click', () => loadCatalog({ append: true }));
elements.dialogClose.addEventListener('click', () => elements.dialog.close());
elements.dialog.addEventListener('click', (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});

document.querySelectorAll('.copy-button').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      showToast('Request copied to clipboard.');
    } catch {
      showToast('Clipboard access is not available.');
    }
  });
});

loadHome();
