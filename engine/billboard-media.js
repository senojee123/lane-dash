/* ============================================================================
   BILLBOARD-MEDIA.JS — ENGINE (generic, shared by every content pack).
   Turns a creative descriptor ({ type: 'image'|'video', url }) into a
   THREE.Texture, cached by url so multiple billboard instances showing the
   same creative share one decode (one <video> element, one texture) instead
   of each spawning its own. No content-pack knowledge lives here — only
   RunnerBillboards (this pack's billboards.js) supplies what plays.

   Depends only on THREE (loaded via the CDN <script> tags in index.html),
   so it's safe to load immediately after those and before any content-pack
   script — nothing here reads AssetRegistry/Palette/etc.

   Texture creation is synchronous from the caller's side: a Texture/
   VideoTexture object is created and returned immediately, and its
   underlying image/video populates asynchronously — three.js only uploads
   to the GPU once the source is actually ready, so assigning the returned
   texture as a material's `.map` straight away is safe even before it has
   loaded (it just renders blank/last-frame until then).
============================================================================ */
const BillboardMedia = {
  _cache: {},          // creative.url -> THREE.Texture
  _placeholderTexture: null,
};

/**
 * A neutral "ad slot" panel for when a billboard has no creative assigned
 * (empty RunnerBillboards, or a URL that fails to load) — so an unfilled
 * slot still reads as intentional ad inventory, not a rendering bug.
 */
BillboardMedia.getPlaceholder = function () {
  if (this._placeholderTexture) return this._placeholderTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2230';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#4a5568';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  ctx.fillStyle = '#8a94a6';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('YOUR AD HERE', canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  this._placeholderTexture = tex;
  return tex;
};

/**
 * Videos are always muted + looping + autoplaying: browsers block unmuted
 * autoplay outright, and an ambient rotating billboard loop competing with
 * the game's own audio would be intrusive regardless. autoplay can still be
 * rejected in some browsers/embeds even when muted (e.g. data-saver modes)
 * — that failure is swallowed on purpose; the texture just stays on
 * whatever frame the video last had (its poster, or black) rather than
 * throwing into the caller.
 */
function buildVideoTexture(url) {
  const video = document.createElement('video');
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.crossOrigin = 'anonymous';
  video.play().catch((err) => {
    console.warn('[BillboardMedia] video autoplay was blocked for', url, err);
  });
  return new THREE.VideoTexture(video);
}

function buildImageTexture(url) {
  const tex = new THREE.TextureLoader().load(url, undefined, undefined, (err) => {
    console.warn('[BillboardMedia] failed to load image creative', url, err);
  });
  if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/** The only entry point billboard-placement code (runner.js) should use. */
BillboardMedia.getTexture = function (creative) {
  if (!creative || !creative.url) return this.getPlaceholder();
  if (this._cache[creative.url]) return this._cache[creative.url];
  const tex = creative.type === 'video' ? buildVideoTexture(creative.url) : buildImageTexture(creative.url);
  this._cache[creative.url] = tex;
  return tex;
};
