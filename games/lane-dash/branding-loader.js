(function () {
  const BACKEND_API = 'https://engagements-six.vercel.app';

  // Read active query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const qInstanceId = urlParams.get('instanceId') || urlParams.get('id');
  const qBrandId = urlParams.get('brandId') || urlParams.get('userId') || urlParams.get('brand');

  // Define cache key
  const cacheKey = qInstanceId
    ? `fanforge_game_config_${qInstanceId}`
    : qBrandId
    ? `fanforge_game_config_${qBrandId}_lane-daze`
    : `fanforge_game_config_lane-daze`;

  // 1. SWR: Load from cache immediately & synchronously
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const cfg = JSON.parse(cached);
      applyConfig(cfg);
    }
  } catch (e) {
    console.warn('Failed to load cached config:', e);
  }

  // 2. Fetch fresh config from API
  const query = qInstanceId
    ? `?instanceId=${encodeURIComponent(qInstanceId)}`
    : qBrandId
    ? `?brandId=${encodeURIComponent(qBrandId)}`
    : '';

  fetch(`${BACKEND_API}/api/game-config/lane-daze${query}`, { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error('Failed to fetch config');
      return r.json();
    })
    .then((cfg) => {
      if (cfg) {
        applyConfig(cfg);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(cfg));
        } catch (e) {}
      }
    })
    .catch((err) => {
      console.warn('API config fetch failed:', err);
    });

  // Expose applyConfig globally so Firebase script can invoke it too
  window.applyConfig = applyConfig;

  function applyConfig(cfg) {
    if (!cfg) return;

    // Check if the config matches (failsafe)
    if (qInstanceId && cfg.instanceId && cfg.instanceId !== qInstanceId) return;
    if (qBrandId && cfg.brandId && cfg.brandId !== qBrandId) return;

    console.log('[Branding Loader] Applying config:', cfg);

    // Map RunnerBrand properties
    if (typeof RunnerBrand !== 'undefined') {
      if (cfg.sponsorLogoUrl || cfg.logoUrl) {
        RunnerBrand.sponsorLogoUrl = cfg.sponsorLogoUrl || cfg.logoUrl;
      }
      if (cfg.collectibleLabel) {
        RunnerBrand.collectibleLabel = cfg.collectibleLabel;
      }
      if (cfg.collectibleColor) {
        let colorVal = cfg.collectibleColor;
        if (typeof colorVal === 'string') {
          // Convert hex string to integer
          colorVal = parseInt(colorVal.replace('#', ''), 16);
        }
        RunnerBrand.collectibleColor = colorVal;
      }
      if (cfg.collectibleImageUrl) {
        RunnerBrand.collectibleImageUrl = cfg.collectibleImageUrl;
      }
      if (cfg.scoreLabel) RunnerBrand.scoreLabel = cfg.scoreLabel;
      if (cfg.multiplierLabel) RunnerBrand.multiplierLabel = cfg.multiplierLabel;
      if (cfg.bestLabel) RunnerBrand.bestLabel = cfg.bestLabel;
    }

    // Map RunnerBillboards
    if (typeof RunnerBillboards !== 'undefined') {
      if (Array.isArray(cfg.billboards) && cfg.billboards.length > 0) {
        RunnerBillboards.length = 0; // Clear defaults
        cfg.billboards.forEach((url) => {
          const isVideo = url.startsWith('data:video/') || 
                          url.toLowerCase().endsWith('.mp4') || 
                          url.toLowerCase().endsWith('.webm') || 
                          url.toLowerCase().endsWith('.mov') ||
                          url.includes('video');
          RunnerBillboards.push({ type: isVideo ? 'video' : 'image', url: url });
        });
      } else if (cfg.billboardUrl) {
        RunnerBillboards.length = 0;
        const isVideo = cfg.billboardUrl.startsWith('data:video/') || 
                        cfg.billboardUrl.toLowerCase().endsWith('.mp4') || 
                        cfg.billboardUrl.toLowerCase().endsWith('.webm') || 
                        cfg.billboardUrl.toLowerCase().endsWith('.mov') ||
                        cfg.billboardUrl.includes('video');
        RunnerBillboards.push({ type: isVideo ? 'video' : 'image', url: cfg.billboardUrl });
      }
    }

    // Map CSS Brand Colors to :root
    const colors = cfg.colors || {};
    const rootStyle = document.documentElement.style;

    if (colors.bg || cfg.themeColor) {
      rootStyle.setProperty('--rd-bg', colors.bg || cfg.themeColor);
    }
    if (colors.gold1) {
      rootStyle.setProperty('--rd-gold-1', colors.gold1);
    }
    if (colors.gold2 || cfg.secondaryColor) {
      rootStyle.setProperty('--rd-gold-2', colors.gold2 || cfg.secondaryColor);
    }
    if (colors.accent3) {
      rootStyle.setProperty('--rd-accent-3', colors.accent3);
    }
    if (colors.accent4) {
      rootStyle.setProperty('--rd-accent-4', colors.accent4);
    }
    if (colors.highlight) {
      rootStyle.setProperty('--rd-highlight', colors.highlight);
    }
    if (colors.multColor) {
      rootStyle.setProperty('--rd-mult-color', colors.multColor);
    }

    // Make sure the collectible color CSS var matches
    let collectibleColorCss = colors.collectibleColor || cfg.collectibleColor;
    if (collectibleColorCss) {
      if (typeof collectibleColorCss === 'number') {
        collectibleColorCss = '#' + collectibleColorCss.toString(16).padStart(6, '0');
      }
      rootStyle.setProperty('--rd-collectible-color', collectibleColorCss);
    }

    // Update running game
    if (window.applyBrandConfig) {
      try {
        window.applyBrandConfig();
      } catch (e) {
        console.warn('Failed to hot-reload applyBrandConfig:', e);
      }
    }
  }
})();
