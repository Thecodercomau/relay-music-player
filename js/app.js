/**
 * Relay Music Player — main app logic.
 * Handles: animated background, auth forms, navbar state, player page
 * (Home / Search / Playlists tabs).
 */
(function () {
  "use strict";

  const isPlayerPage = location.pathname.includes("player.html");

  // Cache the session check so the navbar + player guard share one request
  let sessionCache = null;
  function getSession() {
    if (!sessionCache) sessionCache = Auth.checkSession();
    return sessionCache;
  }

  /* =====================================================
     Animated audio-wave canvas (landing page only)
     ===================================================== */
  function initCanvas() {
    const canvas = document.getElementById("waveCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let bars = [];
    let raf = null;
    const BAR_COUNT = 90;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      bars = Array.from({ length: BAR_COUNT }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        w: 3 + Math.random() * 6,
        speed: 0.15 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2,
        base: 4 + Math.random() * 18,
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = performance.now() / 1000;
      bars.forEach((b) => {
        const h = b.base + Math.sin(t * b.speed * 6 + b.phase) * b.base;
        const alpha = 0.12 + Math.random() * 0.1;
        const hue = 260 + Math.sin(t * 0.3 + b.phase) * 40;
        ctx.fillStyle = `hsla(${hue}, 85%, 65%, ${alpha})`;
        ctx.fillRect(b.x, b.y - h / 2, b.w, h);
        b.y += b.speed;
        if (b.y - h > canvas.height) {
          b.y = -h;
          b.x = Math.random() * canvas.width;
        }
      });
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        draw();
      }
    });
  }

  /* =====================================================
     Navbar — show user state (logged in / out)
     ===================================================== */
  function initNavbar() {
    const authEl = document.getElementById("navbarAuth");
    if (!authEl) return;

    getSession().then((user) => {
      const toPlayer = PHP_BASE === "php" ? "pages/player.html" : "player.html";
      const toLogin = PHP_BASE === "php" ? "pages/login.html" : "login.html";
      const toSignup = PHP_BASE === "php" ? "pages/signup.html" : "signup.html";
      const home = PHP_BASE === "php" ? "index.html" : "../index.html";

      if (user) {
        authEl.innerHTML = isPlayerPage
          ? `<span class="navbar__user">Hi, ${escapeHtml(user.name)}</span>
             <button class="btn btn--ghost btn--sm" id="logoutBtn">Log out</button>`
          : `<span class="navbar__user">${escapeHtml(user.name)}</span>
             <a href="${toPlayer}" class="btn btn--primary btn--sm">Open Player</a>
             <button class="btn btn--ghost btn--sm" id="logoutBtn">Log out</button>`;
      } else {
        authEl.innerHTML = isPlayerPage
          ? `<a href="${toLogin}" class="btn btn--ghost btn--sm">Log in</a>
             <a href="${toSignup}" class="btn btn--primary btn--sm">Sign up</a>`
          : `<a href="${toLogin}" class="btn btn--ghost btn--sm">Log in</a>
             <a href="${toSignup}" class="btn btn--primary btn--sm">Get started</a>`;
      }

      const logoutBtn = authEl.querySelector("#logoutBtn");
      if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
          await Auth.logout();
          window.location.href = home;
        });
      }

      if (user) {
        document.querySelectorAll(".navbar__links .nav-link").forEach((link) => {
          const href = (link.getAttribute("href") || "").toLowerCase();
          if (href.includes("signup") || href.includes("login")) {
            const li = link.closest("li");
            if (li) li.hidden = true;
          }
        });
      }
    });
  }

  /* =====================================================
     Auth pages — signup & login forms
     ===================================================== */
  function initAuthForms() {
    const signupForm = document.getElementById("signupForm");
    const loginForm = document.getElementById("loginForm");
    if (!signupForm && !loginForm) return;

    document.querySelectorAll("[data-toggle-target]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.toggleTarget);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.classList.toggle("is-visible", show);
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      });
    });

    if (signupForm) {
      signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = signupForm.name.value.trim();
        const email = signupForm.email.value.trim();
        const password = signupForm.password.value;
        const errorEl = document.getElementById("formError");
        const btn = document.getElementById("submitBtn");

        if (!name || !email || !password) {
          showFormError(errorEl, "Please fill in all fields.");
          return;
        }
        if (password.length < 6) {
          showFormError(errorEl, "Password must be at least 6 characters.");
          return;
        }

        setLoading(btn, true);
        try {
          const result = await Auth.signup(name, email, password);
          if (result.success) {
            window.location.href = "player.html";
          } else {
            showFormError(errorEl, result.error || "Signup failed. Please try again.");
          }
        } catch {
          showFormError(errorEl, "Cannot reach the server. Is PHP running?");
        } finally {
          setLoading(btn, false);
        }
      });
    }

    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = loginForm.email.value.trim();
        const password = loginForm.password.value;
        const errorEl = document.getElementById("formError");
        const btn = document.getElementById("submitBtn");

        if (!email || !password) {
          showFormError(errorEl, "Please enter your email and password.");
          return;
        }

        setLoading(btn, true);
        try {
          const result = await Auth.login(email, password);
          if (result.success) {
            window.location.href = "player.html";
          } else {
            showFormError(errorEl, result.error || "Login failed. Please try again.");
          }
        } catch {
          showFormError(errorEl, "Cannot reach the server. Is PHP running?");
        } finally {
          setLoading(btn, false);
        }
      });
    }
  }

  function showFormError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function setLoading(btn, loading) {
    if (!btn) return;
    const label = btn.querySelector(".btn__label");
    const spinner = btn.querySelector(".btn__spinner");
    btn.disabled = loading;
    if (loading) {
      if (label && !btn.dataset.original) btn.dataset.original = label.textContent;
      if (label) label.textContent = "Please wait…";
    } else {
      if (label && btn.dataset.original) label.textContent = btn.dataset.original;
    }
    if (spinner) spinner.hidden = !loading;
  }

  /* =====================================================
     Player page
     ===================================================== */
  function initPlayerPage() {
    if (!isPlayerPage) return;

    // ---- Login guard: listening requires an account ----
    getSession().then((user) => {
      if (!user) {
        window.location.href = "login.html";
        return;
      }
      bootPlayer(user);
    });
  }

  function bootPlayer(user) {
    const player = new Player();

    // Admin tab is only for admins
    const adminTab = document.getElementById("adminTab");
    if (adminTab) adminTab.hidden = !(user && user.is_admin);

    // ---- Shared player-bar elements ----
    const playBtn = document.getElementById("playBtn");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const shuffleBtn = document.getElementById("shuffleBtn");
    const repeatBtn = document.getElementById("repeatBtn");
    const progressBar = document.getElementById("progressBar");
    const volumeBar = document.getElementById("volumeBar");
    const currentTimeEl = document.getElementById("currentTime");
    const totalTimeEl = document.getElementById("totalTime");
    const npTitle = document.getElementById("npTitle");
    const npArtist = document.getElementById("npArtist");
    const npArt = document.getElementById("npArt");
    const npEq = document.getElementById("npEq");
    const downloadBtn = document.getElementById("downloadBtn");
    const infoBtn = document.getElementById("infoBtn");
    const toast = document.getElementById("toast");
    const playIcon = document.getElementById("playIcon");

    // Fullscreen Now Playing elements
    const fullscreenBtn = document.getElementById("fullscreenBtn");
    const npFullscreen = document.getElementById("npFullscreen");
    const npFullClose = document.getElementById("npFullClose");
    const npFullMin = document.getElementById("npFullMin");
    const npFullTitle = document.getElementById("npFullTitle");
    const npFullArtist = document.getElementById("npFullArtist");
    const npFullArt = document.getElementById("npFullArt");
    const npFullEq = document.getElementById("npFullEq");
    const npFullCurrent = document.getElementById("npFullCurrent");
    const npFullTotal = document.getElementById("npFullTotal");
    const npFullProgress = document.getElementById("npFullProgress");
    const npFullPlay = document.getElementById("npFullPlay");
    const npFullPrev = document.getElementById("npFullPrev");
    const npFullNext = document.getElementById("npFullNext");
    const npFullShuffle = document.getElementById("npFullShuffle");
    const npFullRepeat = document.getElementById("npFullRepeat");
    const npFullLyricsBtn = document.getElementById("npFullLyricsBtn");
    const npFullLyricsPanel = document.getElementById("npFullLyricsPanel");
    const npFullLyricsText = document.getElementById("npFullLyricsText");
    let scrubbing = false; // true while the user is dragging the timeline

    // ---- Views ----
    const tabs = Array.from(document.querySelectorAll(".player-tab"));
    const views = {
      home: document.getElementById("view-home"),
      search: document.getElementById("view-search"),
      playlists: document.getElementById("view-playlists"),
      admin: document.getElementById("view-admin"),
    };

    // Home view elements
    const homeList = document.getElementById("homeList");
    const homeTitle = document.getElementById("homeTitle");
    const homeCount = document.getElementById("homeCount");
    const homeEmpty = document.getElementById("homeEmpty");
    const homeSkeleton = document.getElementById("homeSkeleton");

    // Search view elements
    const searchList = document.getElementById("searchList");
    const searchTitle = document.getElementById("searchTitle");
    const searchCount = document.getElementById("searchCount");
    const searchEmpty = document.getElementById("searchEmpty");
    const searchSkeleton = document.getElementById("searchSkeleton");
    const searchInput = document.getElementById("searchInput");
    const searchBtn = document.getElementById("searchBtn");
    const searchHint = document.getElementById("searchHint");

    // Playlists view elements
    const newPlaylistBtn = document.getElementById("newPlaylistBtn");
    const emptyCreateBtn = document.getElementById("emptyCreateBtn");
    const playlistGrid = document.getElementById("playlistGrid");
    const playlistEmpty = document.getElementById("playlistEmpty");
    const playlistSkeleton = document.getElementById("playlistSkeleton");
    const playlistListWrap = document.getElementById("playlistListWrap");
    const playlistDetail = document.getElementById("playlistDetail");
    const backBtn = document.getElementById("backBtn");
    const detailList = document.getElementById("detailList");
    const detailTitle = document.getElementById("detailTitle");
    const detailCount = document.getElementById("detailCount");
    const detailEmpty = document.getElementById("detailEmpty");
    const detailSkeleton = document.getElementById("detailSkeleton");

    // Admin view elements
    const adminForm = document.getElementById("adminForm");
    const adminSongCount = document.getElementById("adminSongCount");
    const adminList = document.getElementById("adminList");
    const adminEmpty = document.getElementById("adminEmpty");
    const adminSkeleton = document.getElementById("adminSkeleton");
    const adminUserCount = document.getElementById("adminUserCount");
    const adminUserList = document.getElementById("adminUserList");
    const adminUsersEmpty = document.getElementById("adminUsersEmpty");
    const adminUsersSkeleton = document.getElementById("adminUsersSkeleton");
    const admSubmit = document.getElementById("admSubmit");
    let adminLoaded = false;

    // Menu + modal
    const addMenu = document.getElementById("addMenu");
    const modalOverlay = document.getElementById("modalOverlay");
    const modalTitle = document.getElementById("modalTitle");
    const modalInput = document.getElementById("modalInput");
    const modalConfirm = document.getElementById("modalConfirm");
    const modalCancel = document.getElementById("modalCancel");

    let currentListEl = homeList; // the currently rendered track list (for highlight)
    let homeLoaded = false;
    let playlistsCache = [];
    let pendingAddTrack = null;
    let activeDetailId = null;

    /* ---------------- Toast ---------------- */
    let toastTimer = null;
    function showToast(msg) {
      toast.textContent = msg;
      toast.hidden = false;
      requestAnimationFrame(() => toast.classList.add("toast--show"));
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove("toast--show");
        setTimeout(() => (toast.hidden = true), 300);
      }, 2400);
    }

    /* ---------------- Tab switching ---------------- */
    function switchTab(name) {
      tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.classList.toggle("player-tab--active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      Object.entries(views).forEach(([key, el]) => {
        el.hidden = key !== name;
      });
      closeAddMenu();

      if (name === "home" && !homeLoaded) {
        loadHome();
      }
      if (name === "playlists") {
        loadPlaylists();
      }
      if (name === "search") {
        searchInput.focus();
      }
      if (name === "admin") {
        loadAdmin();
      }
    }

    tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

    /* ---------------- Track row rendering ---------------- */
    function trackRowHTML(track, i, actions) {
      const sourceBadge =
        track.source === "database"
          ? `<span class="track-row__source track-row__source--db" title="From your music database">Library</span>`
          : track.source === "jamendo"
            ? `<span class="track-row__source track-row__source--jamendo" title="Streamed from Jamendo">Jamendo</span>`
            : "";
      const actionBtn =
        actions === "add"
          ? `<button class="track-row__add" data-add="${i}" title="Add to playlist" aria-label="Add to playlist">
               <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
             </button>`
          : actions === "remove"
            ? `<button class="track-row__remove" data-remove="${i}" title="Remove from playlist" aria-label="Remove from playlist">
                 <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
               </button>`
            : "";

      return `
        <div class="track-row" data-index="${i}" role="button" tabindex="0">
          <span class="track-row__num">${i + 1}</span>
          <img class="track-row__art" src="${track.cover || ""}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <div class="track-row__play" title="Play">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <div class="track-row__meta">
            <strong>${escapeHtml(track.title)}</strong>
            <span>${escapeHtml(track.artist)}</span>
            ${sourceBadge}
          </div>
          <span class="track-row__album">${escapeHtml(track.album)}</span>
          <span class="track-row__duration">${formatTime(track.duration)}</span>
          ${actionBtn}
          <button class="track-row__info" title="Track details" data-info="${i}" aria-label="Track details">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M12 11v5"/></svg>
          </button>
          <button class="track-row__download" title="Download" data-download="${i}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
          </button>
        </div>
      `;
    }

    function renderTracks(tracks, listEl, opts = {}) {
      const {
        titleEl = homeTitle,
        countEl = homeCount,
        emptyEl = homeEmpty,
        skeletonEl = homeSkeleton,
        actions = "add",
      } = opts;

      if (titleEl) titleEl.textContent = opts.title || "";
      if (countEl) countEl.textContent = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
      if (emptyEl) emptyEl.hidden = tracks.length > 0;
      if (skeletonEl) skeletonEl.hidden = true;

      currentListEl = listEl;

      // Re-point the player queue so next/prev never play stale tracks
      if (player.currentTrack) {
        const newIndex = tracks.findIndex((t) => t.id === player.currentTrack.id);
        if (newIndex !== -1) {
          player.queue = tracks;
          player.currentIndex = newIndex;
          player._rebuildOrder();
          player._orderIndex = player.order.indexOf(newIndex);
          if (player._orderIndex === -1) player._orderIndex = 0;
        } else {
          player.queue = [];
          player.currentIndex = -1;
        }
      } else {
        player.queue = [];
        player.currentIndex = -1;
      }

      if (!tracks.length) {
        listEl.innerHTML = "";
        return;
      }

      listEl.innerHTML = tracks.map((t, i) => trackRowHTML(t, i, actions)).join("");

      // Row interactions
      listEl.querySelectorAll(".track-row").forEach((row) => {
        const index = Number(row.dataset.index);
        row.addEventListener("click", () => player.playList(tracks, index));
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            player.playList(tracks, index);
          }
        });
      });

      listEl.querySelectorAll(".track-row__download").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          handleDownload(tracks[Number(btn.dataset.download)]);
        });
      });

      listEl.querySelectorAll(".track-row__info").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = Number(btn.dataset.info);
          openTrackDetails(tracks[idx], tracks, idx);
        });
      });

      if (actions === "add") {
        listEl.querySelectorAll(".track-row__add").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            openAddMenu(tracks[Number(btn.dataset.add)], btn);
          });
        });
      }

      if (actions === "remove") {
        listEl.querySelectorAll(".track-row__remove").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            handleRemoveTrack(tracks[Number(btn.dataset.remove)]);
          });
        });
      }
    }

    function highlightCurrent(index) {
      if (!currentListEl) return;
      currentListEl.querySelectorAll(".track-row").forEach((row) => {
        row.classList.toggle("track-row--playing", Number(row.dataset.index) === index);
      });
    }

    function updateNowPlaying(track) {
      if (!track) return;
      npTitle.textContent = track.title;
      npArtist.textContent = `${track.artist} • ${track.album || "Single"}`;
      npFullTitle.textContent = track.title;
      npFullArtist.textContent = `${track.artist} • ${track.album || "Single"}`;
      if (track.coverBig) {
        npArt.style.backgroundImage = `url("${track.coverBig}")`;
        npArt.style.backgroundSize = "cover";
        npArt.style.backgroundPosition = "center";
        npFullArt.style.backgroundImage = `url("${track.coverBig}")`;
        npFullArt.style.backgroundSize = "cover";
        npFullArt.style.backgroundPosition = "center";
      } else {
        npArt.style.backgroundImage = "";
        npFullArt.style.backgroundImage = "";
      }
    }

    /* ---------------- Home: suggested songs ---------------- */
    async function loadHome() {
      homeSkeleton.hidden = false;
      try {
        const tracks = await Api.getTrending(30);
        homeLoaded = true;
        renderTracks(tracks, homeList, {
          title: "✨ Suggested for you",
          titleEl: homeTitle,
          countEl: homeCount,
          emptyEl: homeEmpty,
          skeletonEl: homeSkeleton,
          actions: "add",
        });
      } catch {
        homeSkeleton.hidden = true;
        homeEmpty.hidden = false;
        homeTitle.textContent = "✨ Suggested for you";
        homeCount.textContent = "";
      }
    }

    /* ---------------- Search ---------------- */
    let searchTimer = null;
    let searchSeq = 0;
    async function runSearch() {
      const q = searchInput.value.trim();
      if (!q) return;
      const seq = ++searchSeq;
      searchSkeleton.hidden = false;
      searchHint.textContent = `Searching for “${q}”…`;
      try {
        const tracks = await Api.searchTracks(q);
        if (seq !== searchSeq) return;
        renderTracks(tracks, searchList, {
          title: `Results for “${q}”`,
          titleEl: searchTitle,
          countEl: searchCount,
          emptyEl: searchEmpty,
          skeletonEl: searchSkeleton,
          actions: "add",
        });
        searchHint.textContent = `Showing results for “${q}”. Add any track to a playlist with +.`;
      } catch {
        if (seq !== searchSeq) return;
        searchList.innerHTML = "";
        searchEmpty.hidden = false;
        searchSkeleton.hidden = true;
        searchTitle.textContent = "Results";
        searchCount.textContent = "";
        searchHint.textContent = "Search failed — check your internet connection.";
      }
    }

    searchBtn.addEventListener("click", runSearch);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 600);
    });

    /* ---------------- Player bar events ---------------- */
    player.on("play", () => {
      playIcon.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
      npEq.hidden = false;
      playBtn.setAttribute("aria-label", "Pause");
      npFullEq.hidden = false;
      npFullPlay.innerHTML =
        '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" stroke="none"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
      npFullPlay.setAttribute("aria-label", "Pause");
    });

    player.on("pause", () => {
      playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
      npEq.hidden = true;
      playBtn.setAttribute("aria-label", "Play");
      npFullEq.hidden = true;
      npFullPlay.innerHTML =
        '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>';
      npFullPlay.setAttribute("aria-label", "Play");
    });

    player.on("timeupdate", (current, duration) => {
      // While the user is dragging the timeline, don't fight their thumb
      if (!scrubbing) currentTimeEl.textContent = formatTime(current);
      if (duration) {
        totalTimeEl.textContent = formatTime(duration);
        npFullTotal.textContent = formatTime(duration);
        npFullCurrent.textContent = formatTime(current);
        const pct = Math.min(100, Math.max(0, (current / duration) * 100));
        if (!scrubbing) {
          progressBar.value = pct;
          progressBar.style.setProperty("--progress", `${pct}%`);
          npFullProgress.value = pct;
          npFullProgress.style.setProperty("--progress", `${pct}%`);
        }
      }
    });

    player.on("loadedmetadata", (duration) => {
      totalTimeEl.textContent = formatTime(duration);
      npFullTotal.textContent = formatTime(duration);
      // Only zero the timeline for a genuinely new track; streaming sources
      // can re-fire loadedmetadata mid-track (duration finalization) and
      // that must not reset the listener's position.
      if (player.audio.currentTime < 1) resetProgress();
    });

    player.on("ended", () => player.next());

    player.on("error", (err) => {
      if (err) showToast(err.message || "Playback error");
    });

    playBtn.addEventListener("click", () => player.togglePlay());
    nextBtn.addEventListener("click", () => player.next());
    prevBtn.addEventListener("click", () => player.prev());

    shuffleBtn.addEventListener("click", () => {
      const on = player.toggleShuffle();
      shuffleBtn.classList.toggle("icon-btn--active", on);
      shuffleBtn.setAttribute("aria-label", on ? "Shuffle on" : "Shuffle off");
      showToast(on ? "Shuffle on" : "Shuffle off");
    });

    repeatBtn.addEventListener("click", () => {
      const on = player.toggleRepeat();
      repeatBtn.classList.toggle("icon-btn--active", on);
      repeatBtn.setAttribute("aria-label", on ? "Repeat on" : "Repeat off");
      showToast(on ? "Repeat on" : "Repeat off");
    });

    // Seek — mark scrubbing so timeupdate can't override the drag position
    progressBar.addEventListener("pointerdown", () => {
      scrubbing = true;
    });
    progressBar.addEventListener("input", () => {
      const v = Number(progressBar.value);
      progressBar.style.setProperty("--progress", `${v}%`);
      npFullProgress.value = v;
      npFullProgress.style.setProperty("--progress", `${v}%`);
      if (player.audio.duration) {
        const t = formatTime((v / 100) * player.audio.duration);
        currentTimeEl.textContent = t;
        npFullCurrent.textContent = t;
      }
      player.seek(v);
    });
    const endScrub = () => {
      scrubbing = false;
      player.seek(Number(progressBar.value));
    };
    progressBar.addEventListener("change", endScrub);
    progressBar.addEventListener("pointerup", endScrub);
    progressBar.addEventListener("pointercancel", () => {
      scrubbing = false;
    });
    // Keyboard scrubbing (arrow keys on the focused slider) must not fight timeupdate either
    progressBar.addEventListener("keydown", () => {
      scrubbing = true;
    });
    progressBar.addEventListener("keyup", endScrub);
    volumeBar.addEventListener("input", () => {
      player.setVolume(Number(volumeBar.value));
      volumeBar.style.setProperty("--progress", `${volumeBar.value}%`);
    });
    volumeBar.style.setProperty("--progress", `${volumeBar.value}%`);

    downloadBtn.addEventListener("click", () => handleDownload(player.currentTrack));
    infoBtn.addEventListener("click", () =>
      openTrackDetails(player.currentTrack, player.queue, player.currentIndex)
    );

    /* ---------------- Fullscreen Now Playing ---------------- */
    function openFullscreen() {
      npFullscreen.hidden = false;
      document.body.style.overflow = "hidden";
      refreshFullscreenLyrics(); // re-sync if the track changed while closed
    }
    function closeFullscreen() {
      npFullscreen.hidden = true;
      document.body.style.overflow = "";
    }
    fullscreenBtn.addEventListener("click", openFullscreen);
    npFullClose.addEventListener("click", closeFullscreen);
    npFullMin.addEventListener("click", closeFullscreen);
    npFullscreen.addEventListener("click", (e) => {
      if (e.target === npFullscreen) closeFullscreen();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !npFullscreen.hidden) closeFullscreen();
    });

    npFullPlay.addEventListener("click", () => player.togglePlay());
    npFullPrev.addEventListener("click", () => player.prev());
    npFullNext.addEventListener("click", () => player.next());
    npFullShuffle.addEventListener("click", () => {
      const on = player.toggleShuffle();
      npFullShuffle.classList.toggle("icon-btn--active", on);
      npFullShuffle.setAttribute("aria-label", on ? "Shuffle on" : "Shuffle off");
    });
    npFullRepeat.addEventListener("click", () => {
      const on = player.toggleRepeat();
      npFullRepeat.classList.toggle("icon-btn--active", on);
      npFullRepeat.setAttribute("aria-label", on ? "Repeat on" : "Repeat off");
    });

    // Fullscreen timeline — same seek handling as the main bar
    npFullProgress.addEventListener("pointerdown", () => {
      scrubbing = true;
    });
    npFullProgress.addEventListener("input", () => {
      const v = Number(npFullProgress.value);
      npFullProgress.style.setProperty("--progress", `${v}%`);
      progressBar.value = v;
      progressBar.style.setProperty("--progress", `${v}%`);
      if (player.audio.duration) {
        const t = formatTime((v / 100) * player.audio.duration);
        npFullCurrent.textContent = t;
        currentTimeEl.textContent = t;
      }
      player.seek(v);
    });
    npFullProgress.addEventListener("change", endScrub);
    npFullProgress.addEventListener("pointerup", endScrub);
    npFullProgress.addEventListener("pointercancel", () => {
      scrubbing = false;
    });
    npFullProgress.addEventListener("keydown", () => {
      scrubbing = true;
    });
    npFullProgress.addEventListener("keyup", endScrub);

    /* ---------------- Fullscreen lyrics ---------------- */
    let lyricsOpen = false;
    let lyricsSeq = 0; // guard against out-of-order responses
    const lyricsCache = new Map(); // track.id -> lyrics text

    async function loadFullscreenLyrics(track) {
      if (!track) return;
      const cached = lyricsCache.get(track.id);
      if (cached !== undefined) {
        npFullLyricsText.textContent = cached;
        return;
      }
      const seq = ++lyricsSeq;
      npFullLyricsText.textContent = "Loading lyrics…";
      try {
        const d = await Api.getTrackDetails(track.id);
        if (seq !== lyricsSeq) return; // track changed while loading
        const text = d.lyrics || "No lyrics available for this track.";
        lyricsCache.set(track.id, text);
        npFullLyricsText.textContent = text;
      } catch {
        if (seq !== lyricsSeq) return;
        npFullLyricsText.textContent = "Couldn't load lyrics — check your connection.";
      }
    }

    function setLyricsMode(open) {
      lyricsOpen = open;
      npFullLyricsBtn.classList.toggle("icon-btn--active", open);
      npFullLyricsBtn.setAttribute("aria-label", open ? "Hide lyrics" : "Show lyrics");
      npFullLyricsPanel.hidden = !open;
      npFullscreen.classList.toggle("np-fullscreen--lyrics", open);
      if (open) loadFullscreenLyrics(player.currentTrack);
    }

    /** Re-fetch lyrics when the playing track changes while lyrics are open. */
    function refreshFullscreenLyrics() {
      if (lyricsOpen && !npFullscreen.hidden) loadFullscreenLyrics(player.currentTrack);
    }

    npFullLyricsBtn.addEventListener("click", () => setLyricsMode(!lyricsOpen));

    /* ---------------- Progress bar helpers ---------------- */
    function resetProgress() {
      progressBar.value = 0;
      progressBar.style.setProperty("--progress", "0%");
      npFullProgress.value = 0;
      npFullProgress.style.setProperty("--progress", "0%");
      currentTimeEl.textContent = "0:00";
      npFullCurrent.textContent = "0:00";
    }

    // Highlight + now-playing updates funnel through _playAt
    const origPlayAt = player._playAt.bind(player);
    player._playAt = (index) => {
      const prevTrack = player.currentTrack;
      origPlayAt(index);
      highlightCurrent(index);
      updateNowPlaying(player.currentTrack);
      refreshFullscreenLyrics();
      // Zero the timeline only when the track actually changes (clicking
      // the same row keeps your position).
      if (!prevTrack || prevTrack.id !== (player.currentTrack && player.currentTrack.id)) {
        resetProgress();
      }
    };

    /* ---------------- Download ---------------- */
    async function handleDownload(track) {
      if (!track) {
        showToast("Nothing to download yet.");
        return;
      }
      try {
        showToast(`Downloading “${track.title}”…`);
        const preview = track.downloadUrl || track.preview || "";
        // Local uploads (paths starting with "/") are same-origin — fetch
        // directly. External URLs go through the PHP proxy so downloads
        // work even if the remote host doesn't send CORS headers.
        const proxyUrl = preview.startsWith("/")
          ? null
          : `${Api.base()}/music.php?action=stream&url=${encodeURIComponent(preview)}`;
        await player.download(track, proxyUrl);
        showToast("Download started ✓");
      } catch (err) {
        showToast(err.message || "Download failed.");
      }
    }

    /* ---------------- Track details modal ---------------- */
    const detailsOverlay = document.getElementById("detailsOverlay");
    const detailsPanel = document.getElementById("trackDetails");
    const tdArt = document.getElementById("tdArt");
    const tdTitle = document.getElementById("tdTitle");
    const tdArtist = document.getElementById("tdArtist");
    const tdAlbum = document.getElementById("tdAlbum");
    const tdChips = document.getElementById("tdChips");
    const tdLicense = document.getElementById("tdLicense");
    const tdLyrics = document.getElementById("tdLyrics");
    const tdPlay = document.getElementById("tdPlay");
    const tdAdd = document.getElementById("tdAdd");
    const tdDownload = document.getElementById("tdDownload");
    const tdClose = document.getElementById("tdClose");
    let currentDetails = null; // last rendered details object
    let detailsContext = null; // play queue the details were opened from
    let detailsIndex = -1;
    let detailsSeq = 0; // guard against out-of-order responses (same as searchSeq)

    async function openTrackDetails(track, contextTracks, contextIndex) {
      if (!track) return;
      const seq = ++detailsSeq;
      detailsOverlay.hidden = false;
      detailsPanel.classList.add("track-details--loading");
      tdLyrics.textContent = "Loading details…";
      tdLyrics.hidden = false;
      tdLicense.hidden = true;
      tdDownload.hidden = false;
      currentDetails = null;

      try {
        const d = await Api.getTrackDetails(track.id);
        if (seq !== detailsSeq) return; // a newer request superseded this one
        renderTrackDetails(d, contextTracks, contextIndex);
      } catch (err) {
        if (seq !== detailsSeq) return;
        // Fall back to the summary we already have (e.g. no client_id yet)
        renderTrackDetails(
          {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album || "",
            cover: track.coverBig || track.cover || "",
            duration: track.duration || 0,
            preview: track.preview || "",
            downloadUrl: track.preview || "",
            downloadAllowed: true,
            releasedate: "",
            lang: "",
            tags: [],
            license: "",
            lyrics: "",
            source: track.source || "",
          },
          contextTracks,
          contextIndex
        );
        tdLyrics.hidden = false;
        tdLyrics.textContent = err.message || "Couldn't load full details.";
      }
    }

    function renderTrackDetails(d, contextTracks, contextIndex) {
      detailsPanel.classList.remove("track-details--loading");
      currentDetails = d;
      detailsContext = contextTracks || null;
      detailsIndex = typeof contextIndex === "number" ? contextIndex : -1;

      tdArt.src = d.cover || "";
      tdTitle.textContent = d.title || "Unknown track";
      tdArtist.textContent = d.artist || "Unknown artist";
      tdAlbum.textContent = d.album || "Single";

      const chips = [];
      if (d.duration) chips.push(`<span class="track-details__chip">${formatTime(d.duration)}</span>`);
      if (d.releasedate) {
        chips.push(`<span class="track-details__chip">${escapeHtml(String(d.releasedate).slice(0, 4))}</span>`);
      }
      (d.tags || []).slice(0, 3).forEach((tag) => {
        chips.push(`<span class="track-details__chip">${escapeHtml(tag)}</span>`);
      });
      if (d.lang) chips.push(`<span class="track-details__chip">${escapeHtml(String(d.lang).toUpperCase())}</span>`);
      tdChips.innerHTML = chips.join("");

      if (d.license) {
        tdLicense.hidden = false;
        tdLicense.innerHTML =
          `Creative Commons — <a href="${escapeHtml(d.license)}" target="_blank" rel="noopener">${escapeHtml(ccName(d.license))}</a>`;
      } else {
        tdLicense.hidden = true;
      }

      if (d.lyrics) {
        tdLyrics.hidden = false;
        tdLyrics.textContent = d.lyrics;
      } else {
        tdLyrics.hidden = true;
      }

      tdDownload.hidden = d.downloadAllowed === false || !d.downloadUrl;
    }

    /** "https://creativecommons.org/licenses/by-nc-nd/3.0/" → "CC BY-NC-ND" */
    function ccName(url) {
      const m = String(url).match(/licenses\/([a-z0-9-]+)\//);
      const slug = m ? m[1].toUpperCase().replace(/-/g, " ") : "CC License";
      return `CC ${slug}`;
    }

    function closeTrackDetails() {
      detailsOverlay.hidden = true;
      detailsContext = null;
      detailsIndex = -1;
    }

    tdClose.addEventListener("click", closeTrackDetails);
    detailsOverlay.addEventListener("click", (e) => {
      if (e.target === detailsOverlay) closeTrackDetails();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !detailsOverlay.hidden) closeTrackDetails();
    });

    tdPlay.addEventListener("click", () => {
      if (!currentDetails) return;
      // Capture the play context before closing (closeTrackDetails clears it)
      const ctx = detailsContext;
      const idx = detailsIndex;
      closeTrackDetails();
      if (ctx && ctx.length && idx >= 0) {
        player.playList(ctx, idx);
      } else {
        player.playList([toPlayerTrackLike(currentDetails)], 0);
      }
    });

    tdAdd.addEventListener("click", (e) => {
      if (!currentDetails) return;
      // stopPropagation so the document click-listener doesn't instantly
      // close the just-opened add-to-playlist menu (matches row buttons)
      e.stopPropagation();
      openAddMenu(toPlayerTrackLike(currentDetails), tdAdd);
    });

    tdDownload.addEventListener("click", () => {
      if (!currentDetails) return;
      handleDownload(currentDetails);
    });

    /** Shape a details object into a playable track. */
    function toPlayerTrackLike(d) {
      return {
        id: d.id,
        title: d.title,
        artist: d.artist,
        album: d.album || "",
        duration: Number(d.duration) || 0,
        preview: d.preview || "",
        cover: d.cover || "",
        coverBig: d.cover || "",
        source: d.source || "",
      };
    }

    /* ---------------- Playlists: list / create ---------------- */
    async function loadPlaylists() {
      playlistSkeleton.hidden = false;
      try {
        const data = await Playlists.list();
        playlistsCache = data.playlists || [];
        renderPlaylistGrid();
      } catch (err) {
        playlistSkeleton.hidden = true;
        playlistEmpty.hidden = false;
        playlistEmpty.querySelector("h3").textContent = "Couldn't load playlists";
        playlistEmpty.querySelector("p").textContent = err.message || "Try again in a moment.";
      } finally {
        playlistSkeleton.hidden = true;
      }
    }

    function renderPlaylistGrid() {
      playlistSkeleton.hidden = true;
      // Restore the default empty-state copy (a previous load may have errored)
      playlistEmpty.querySelector("h3").textContent = "No playlists yet";
      playlistEmpty.querySelector("p").textContent =
        "Create your first playlist and start collecting tracks.";
      playlistEmpty.querySelector("button").style.display = "";
      playlistEmpty.hidden = playlistsCache.length > 0;
      playlistGrid.innerHTML = "";

      playlistsCache.forEach((pl) => {
        const card = document.createElement("div");
        card.className = "playlist-card";
        card.innerHTML = `
          <div class="playlist-card__art">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"/><path d="M3 9h18"/><path d="M16 19l-2-2 2-2"/><path d="M14 17h7"/></svg>
          </div>
          <div class="playlist-card__body">
            <strong>${escapeHtml(pl.name)}</strong>
            <span>${Number(pl.track_count) || 0} track${Number(pl.track_count) === 1 ? "" : "s"}</span>
          </div>
          <button class="playlist-card__del" title="Delete playlist" aria-label="Delete playlist">×</button>
        `;

        card.querySelector(".playlist-card__del").addEventListener("click", (e) => {
          e.stopPropagation();
          confirmDeletePlaylist(pl);
        });
        card.addEventListener("click", () => openPlaylist(pl.id));
        playlistGrid.appendChild(card);
      });
    }

    function openCreateModal() {
      modalTitle.textContent = "New playlist";
      modalInput.hidden = false;
      modalInput.value = "";
      modalConfirm.textContent = "Create";
      showModal();
      modalInput.focus();

      const onSubmit = async () => {
        const name = modalInput.value.trim();
        if (!name) {
          showToast("Please enter a playlist name.");
          return;
        }
        // Capture before hideModal() clears it (modal opened from add-menu flow)
        const trackToAdd = pendingAddTrack;
        try {
          const res = await Playlists.create(name);
          const created = res.playlist;
          playlistsCache.unshift(created);
          renderPlaylistGrid();
          hideModal();
          showToast(`Playlist “${name}” created ✓`);
          if (trackToAdd) {
            await addTrackToPlaylist(created.id, trackToAdd);
          }
        } catch (err) {
          showToast(err.message || "Could not create playlist.");
        }
      };
      modalConfirm.onclick = onSubmit;
      modalInput.onkeydown = (e) => {
        if (e.key === "Enter") onSubmit();
      };
    }

    function confirmDeletePlaylist(pl) {
      modalTitle.textContent = `Delete “${pl.name}”?`;
      modalInput.hidden = true;
      modalConfirm.textContent = "Delete";
      showModal();

      const onSubmit = async () => {
        try {
          await Playlists.delete(pl.id);
          playlistsCache = playlistsCache.filter((p) => p.id !== pl.id);
          renderPlaylistGrid();
          hideModal();
          showToast("Playlist deleted.");
        } catch (err) {
          showToast(err.message || "Could not delete playlist.");
        }
      };
      modalConfirm.onclick = onSubmit;
    }

    function showModal() {
      modalOverlay.hidden = false;
      requestAnimationFrame(() => modalInput.focus());
    }
    function hideModal() {
      modalOverlay.hidden = true;
      modalConfirm.onclick = null;
      modalInput.onkeydown = null;
      pendingAddTrack = null; // never leak an abandoned track into a later playlist
    }

    modalCancel.addEventListener("click", hideModal);
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) hideModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modalOverlay.hidden) hideModal();
    });
    // Standalone create buttons always start a fresh playlist
    newPlaylistBtn.addEventListener("click", () => {
      pendingAddTrack = null;
      openCreateModal();
    });
    emptyCreateBtn.addEventListener("click", () => {
      pendingAddTrack = null;
      openCreateModal();
    });

    /* ---------------- Playlists: open detail ---------------- */
    async function openPlaylist(id) {
      activeDetailId = id;
      playlistListWrap.hidden = true;
      playlistDetail.hidden = false;
      detailSkeleton.hidden = false;
      detailList.innerHTML = "";

      // Restore default empty-state copy in case a previous open failed
      detailEmpty.querySelector("h3").textContent = "This playlist is empty";
      detailEmpty.querySelector("p").textContent =
        "Use the + button on any track to add it here.";

      try {
        const data = await Playlists.get(id);
        if (activeDetailId !== id) return; // user navigated away
        const tracks = (data.tracks || []).map(normalizeDbTrack);
        detailTitle.textContent = data.playlist.name;
        renderTracks(tracks, detailList, {
          title: data.playlist.name,
          titleEl: detailTitle,
          countEl: detailCount,
          emptyEl: detailEmpty,
          skeletonEl: detailSkeleton,
          actions: "remove",
        });
      } catch (err) {
        detailSkeleton.hidden = true;
        detailEmpty.hidden = false;
        detailEmpty.querySelector("h3").textContent = "Couldn't open playlist";
        detailEmpty.querySelector("p").textContent = err.message || "Try again.";
      }
    }

    backBtn.addEventListener("click", () => {
      activeDetailId = null;
      playlistDetail.hidden = true;
      playlistListWrap.hidden = false;
    });

    async function handleRemoveTrack(track) {
      if (!activeDetailId || !track) return;
      try {
        await Playlists.removeTrack(activeDetailId, track.id);
        showToast(`Removed “${track.title}”.`);
        // Refresh the open playlist
        const pl = playlistsCache.find((p) => p.id === activeDetailId);
        if (pl) pl.track_count = Math.max(0, Number(pl.track_count) - 1);
        openPlaylist(activeDetailId);
      } catch (err) {
        showToast(err.message || "Could not remove track.");
      }
    }

    /* ---------------- Add to playlist menu ---------------- */
    async function openAddMenu(track, anchorBtn) {
      pendingAddTrack = track;
      try {
        if (!playlistsCache.length) {
          const data = await Playlists.list();
          playlistsCache = data.playlists || [];
        }
      } catch (err) {
        showToast(err.message || "Could not load playlists.");
        return;
      }

      const items = playlistsCache.length
        ? playlistsCache
            .map(
              (pl) => `<button class="add-menu__item" data-pid="${pl.id}">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"/><path d="M3 9h18"/><path d="M16 19l-2-2 2-2"/><path d="M14 17h7"/></svg>
                ${escapeHtml(pl.name)}
              </button>`
            )
            .join("")
        : '<div class="add-menu__empty">No playlists yet — create one!</div>';

      addMenu.innerHTML = `
        <div class="add-menu__head">Add “${escapeHtml(track.title)}” to…</div>
        ${items}
        <button class="add-menu__item add-menu__item--new">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          New playlist…
        </button>
      `;

      // Position near the clicked button
      const rect = anchorBtn.getBoundingClientRect();
      addMenu.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
      addMenu.style.top = `${rect.bottom + 6}px`;
      addMenu.hidden = false;

      addMenu.querySelectorAll(".add-menu__item").forEach((item) => {
        item.addEventListener("click", async () => {
          const pid = item.dataset.pid;
          if (pid) {
            await addTrackToPlaylist(Number(pid), pendingAddTrack);
            pendingAddTrack = null;
          } else {
            // "New playlist…" — keep pendingAddTrack so the created
            // playlist receives the track on submit.
            openCreateModal();
          }
          closeAddMenu();
        });
      });
    }

    async function addTrackToPlaylist(playlistId, track) {
      if (!track) return;
      try {
        await Playlists.addTrack({
          playlist_id: playlistId,
          deezer_id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album || "",
          cover: track.cover || "",
          cover_big: track.coverBig || "",
          preview: track.preview || "",
          duration: track.duration || 0,
          source: track.source || "",
        });
        const pl = playlistsCache.find((p) => p.id === playlistId);
        showToast(`Added to “${pl ? pl.name : "playlist"}” ✓`);
      } catch (err) {
        showToast(err.message || "Could not add track.");
      }
    }

    function closeAddMenu() {
      addMenu.hidden = true;
    }

    document.addEventListener("click", (e) => {
      if (!addMenu.hidden && !addMenu.contains(e.target)) closeAddMenu();
    });
    window.addEventListener("scroll", closeAddMenu, true);

    /* ---------------- Admin: manage your songs library + users ---------------- */
    async function loadAdmin() {
      if (!adminForm) return;
      if (!adminLoaded) {
        adminLoaded = true;
        adminForm.addEventListener("submit", onAdminSubmit);
      }
      adminSkeleton.hidden = false;
      adminUsersSkeleton.hidden = false;
      try {
        const [songsData, usersData] = await Promise.all([
          Api.adminSongs(),
          Api.adminUsers(),
        ]);
        renderAdminSongs(songsData.songs || []);
        renderAdminUsers(usersData.users || []);
      } catch (err) {
        adminSkeleton.hidden = true;
        adminUsersSkeleton.hidden = true;
        adminEmpty.hidden = false;
        adminEmpty.querySelector("h3").textContent = "Couldn't load your library";
        adminEmpty.querySelector("p").textContent = err.message || "Try again in a moment.";
      } finally {
        adminSkeleton.hidden = true;
        adminUsersSkeleton.hidden = true;
      }
    }

    function renderAdminUsers(users) {
      adminUsersEmpty.hidden = users.length > 0;
      adminUserCount.textContent = `${users.length} user${users.length === 1 ? "" : "s"}`;
      adminUserList.innerHTML = "";

      users.forEach((u) => {
        const me = u.id === Number(user.id);
        const row = document.createElement("div");
        row.className = "user-row";
        row.innerHTML = `
          <span class="user-row__avatar">${escapeHtml((u.name || "?")[0].toUpperCase())}</span>
          <div class="user-row__meta">
            <strong>${escapeHtml(u.name)}${me ? " <em>(you)</em>" : ""}</strong>
            <span>${escapeHtml(u.email)}</span>
          </div>
          <span class="user-row__badge ${u.is_admin ? "user-row__badge--on" : ""}">${u.is_admin ? "Admin" : "Member"}</span>
          <button class="user-row__toggle ${u.is_admin ? "is-on" : ""}" role="switch" aria-checked="${u.is_admin}" data-uid="${u.id}" ${me ? "disabled" : ""}>
            <span class="user-row__toggle-knob"></span>
          </button>
        `;

        const toggle = row.querySelector(".user-row__toggle");
        if (toggle) {
          toggle.addEventListener("click", () => toggleAdmin(u, toggle));
        }
        adminUserList.appendChild(row);
      });
    }

    function toggleAdmin(u, toggleEl) {
      const turningOn = !u.is_admin;
      if (turningOn) {
        // No confirmation needed to grant — just do it.
        applyAdminChange(u, toggleEl, true);
        return;
      }
      // Demoting — confirm first, using the same modal as song deletion.
      modalTitle.textContent = `Remove admin from “${u.name || "this user"}”?`;
      modalInput.hidden = true;
      modalConfirm.textContent = "Remove";
      showModal();
      modalConfirm.onclick = () => {
        hideModal();
        applyAdminChange(u, toggleEl, false);
      };
    }

    async function applyAdminChange(u, toggleEl, turningOn) {
      const name = u.name || "this user";
      toggleEl.disabled = true;
      try {
        await Api.setAdmin(u.id, turningOn);
        u.is_admin = turningOn;
        showToast(turningOn ? `“${name}” is now an admin ✓` : `“${name}” is no longer an admin.`);
        // Re-render so badges + disabled states stay consistent
        const data = await Api.adminUsers();
        renderAdminUsers(data.users || []);
      } catch (err) {
        toggleEl.disabled = false;
        showToast(err.message || "Could not update admin access.");
      }
    }

    function renderAdminSongs(songs) {
      // Restore the default empty-state copy (a previous load may have errored)
      adminEmpty.querySelector("h3").textContent = "Your library is empty";
      adminEmpty.querySelector("p").textContent =
        "Add your first song above — upload a file or paste an audio URL.";
      adminEmpty.hidden = songs.length > 0;
      adminSongCount.textContent = `${songs.length} song${songs.length === 1 ? "" : "s"}`;
      adminList.innerHTML = "";

      songs.forEach((s, i) => {
        const row = document.createElement("div");
        row.className = "track-row admin-row";
        row.innerHTML = `
          <span class="track-row__num">${i + 1}</span>
          <img class="track-row__art" src="${s.cover || ""}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <div class="track-row__meta">
            <strong>${escapeHtml(s.title)}</strong>
            <span>${escapeHtml(s.artist)}</span>
          </div>
          <span class="track-row__album">${escapeHtml(s.album || "")}</span>
          <span class="track-row__duration">${formatTime(s.duration)}</span>
          <span class="track-row__source track-row__source--db" title="From your music database">Library</span>
          <button class="track-row__download" title="Play preview" data-play="${i}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="admin-row__del" title="Delete song" data-del="${i}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        `;

        row.querySelector("[data-play]").addEventListener("click", (e) => {
          e.stopPropagation();
          player.playList(songs.map(toPlayerTrack), i);
        });
        row.querySelector("[data-del]").addEventListener("click", (e) => {
          e.stopPropagation();
          confirmDeleteSong(s);
        });
        adminList.appendChild(row);
      });
    }

    /** Convert an admin songs row into a playable track. */
    function toPlayerTrack(s) {
      return {
        id: Number(s.id),
        title: s.title,
        artist: s.artist,
        album: s.album || "",
        duration: Number(s.duration) || 0,
        preview: s.audio_url || "",
        cover: s.cover || "",
        coverBig: s.cover || "",
        source: "database",
      };
    }

    async function onAdminSubmit(e) {
      e.preventDefault();
      const title = document.getElementById("admTitle").value.trim();
      const artist = document.getElementById("admArtist").value.trim();
      const album = document.getElementById("admAlbum").value.trim();
      const cover = document.getElementById("admCover").value.trim();
      const fileInput = document.getElementById("admFile");
      const urlInput = document.getElementById("admUrl");

      if (!title || !artist || !album) {
        showToast("Title, artist and album are required.");
        return;
      }
      const file = fileInput.files[0];
      const audioUrl = urlInput.value.trim();
      if (!file && !audioUrl) {
        showToast("Choose an audio file or paste an audio URL.");
        return;
      }
      if (file && audioUrl) {
        showToast("Pick one — either a file or a URL, not both.");
        return;
      }

      const body = new FormData();
      body.append("action", "add");
      body.append("title", title);
      body.append("artist", artist);
      body.append("album", album);
      body.append("cover", cover);
      if (file) body.append("audio", file);
      else body.append("audio_url", audioUrl);

      setLoading(admSubmit, true);
      try {
        const res = await fetch(`${Api.base()}/songs.php`, {
          method: "POST",
          credentials: "same-origin",
          body,
        });
        let data = null;
        try {
          data = await res.json();
        } catch {
          // Not JSON — surface the raw reason instead of a cryptic parse error
          throw new Error(
            "The server returned an unexpected response. Check that PHP is running and restart it if a warning appears in its console."
          );
        }
        if (!res.ok) throw new Error(data.error || "Could not add song.");
        showToast(`“${data.song.title}” added ✓`);
        document.getElementById("adminForm").reset();
        await loadAdmin();
      } catch (err) {
        showToast(err.message || "Could not add song.");
      } finally {
        setLoading(admSubmit, false);
      }
    }

    function confirmDeleteSong(song) {
      modalTitle.textContent = `Delete “${song.title}”?`;
      modalInput.hidden = true;
      modalConfirm.textContent = "Delete";
      showModal();

      modalConfirm.onclick = async () => {
        try {
          const res = await fetch(`${Api.base()}/songs.php`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ action: "delete", id: song.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not delete song.");
          hideModal();
          showToast(`Deleted “${song.title}”.`);
          await loadAdmin();
        } catch (err) {
          hideModal();
          showToast(err.message || "Could not delete song.");
        }
      };
    }

    /* ---------------- Boot ---------------- */
    switchTab("home");
  }

  /* =====================================================
     Boot
     ===================================================== */
  document.addEventListener("DOMContentLoaded", () => {
    if (!isPlayerPage) initCanvas();
    initNavbar();
    initAuthForms();
    if (isPlayerPage) initPlayerPage();
  });

  /** Convert a stored playlist-track row back into a player track. */
  function normalizeDbTrack(t) {
    return {
      id: Number(t.deezer_id),
      title: t.title,
      artist: t.artist,
      album: t.album || "",
      duration: Number(t.duration) || 0,
      preview: t.preview || "",
      cover: t.cover || "",
      coverBig: t.cover_big || "",
      source: t.source || "",
    };
  }
})();
