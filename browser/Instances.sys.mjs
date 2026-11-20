// Discovery metadata describes a browser process. Each bind gets a fresh socket name so
// stale cleanup can never unlink the new listener during a reload or after PID reuse.
export function instanceSocket({
  socketOverride,
  runtime,
  app,
  localFile,
  writeTextFile,
  logError,
  setTimeout,
  clearTimeout,
  lifetime,
}) {
  const windows = new Set();
  let file;
  let metadataFile;
  let metadata;
  let timer;
  let lastWrite = 0;

  function write() {
    writeTextFile(metadataFile, JSON.stringify({ ...metadata, focusedAt: lifetime.focusedAt }) + "\n", {
      atomic: true,
    });
    lastWrite = Date.now();
  }

  function activate() {
    lifetime.focusedAt = Date.now();
    if (!metadata || timer) return;
    timer = setTimeout(
      () => {
        timer = null;
        try {
          write();
        } catch (error) {
          logError("instance focus", error);
        }
      },
      Math.max(0, 500 - (Date.now() - lastWrite)),
    );
  }

  function detach(event) {
    const win = event.currentTarget;
    win.removeEventListener("activate", activate);
    windows.delete(win);
  }

  return {
    attach(win) {
      if (socketOverride || windows.has(win)) return;
      windows.add(win);
      win.addEventListener("activate", activate);
      win.addEventListener("unload", detach, { once: true });
      if (Services.focus.activeWindow === win && !lifetime.focusedAt) activate();
    },

    prepare() {
      let socket = socketOverride;
      let directory;
      if (!socket) {
        const suffix = /\/(?:var\/)?tmp\/?$/.test(runtime)
          ? "-" +
            [...Services.env.get("HOME")]
              .reduce((hash, c) => (Math.imul(hash, 31) + c.codePointAt(0)) >>> 0, 0)
              .toString(16)
          : "";
        directory = localFile(`${runtime}/${app}${suffix}`);
        const id = Services.uuid
          .generateUUID()
          .toString()
          .replace(/[^a-f0-9]/g, "")
          .slice(0, 16);
        socket = `${directory.path}/${id}.sock`;
        metadataFile = localFile(`${directory.path}/${id}.json`);
      }
      const max = Services.appinfo.OS === "Linux" ? 107 : 103;
      if (unescape(encodeURIComponent(socket)).length > max)
        throw new Error(
          `Unix socket path exceeds ${max} bytes: ${socket}. Use a shorter XDG_RUNTIME_DIR or ZEN_MCP_SOCKET.`,
        );
      if (directory) {
        if (!directory.exists()) {
          try {
            directory.create(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
          } catch (error) {
            if (!directory.exists()) throw error; // another browser just created it
          }
        }
        if (directory.isSymlink() || !directory.isDirectory() || directory.permissions & 0o077)
          throw new Error(`Instance directory must be private (0700): ${directory.path}`);
      }
      file = localFile(socket);
      if (file.exists()) throw new Error(`Browser socket path already exists: ${socket}`);
      return file;
    },

    publish(bridgeVersion, bridgeGeneration) {
      if (socketOverride) return;
      const profile = Services.dirsvc.get("ProfD", Ci.nsIFile);
      const installation = Services.dirsvc.get("GreD", Ci.nsIFile);
      let profileName;
      try {
        const profiles = Cc["@mozilla.org/toolkit/profile-service;1"].getService(Ci.nsIToolkitProfileService);
        profileName = [...profiles.profiles].find((entry) => entry.rootDir.equals(profile))?.name;
      } catch {}
      metadata = {
        browser: Services.appinfo.name,
        installationDir: installation.path,
        profileDir: profile.path,
        ...(profileName ? { profileName } : {}),
        pid: Services.appinfo.processID,
        bridgeVersion,
        bridgeGeneration,
        startedAt: lifetime.startedAt,
      };
      write();
    },

    stop(owned) {
      clearTimeout(timer);
      timer = null;
      for (const win of windows) {
        win.removeEventListener("activate", activate);
        win.removeEventListener("unload", detach);
      }
      windows.clear();
      if (owned) {
        for (const entry of [metadataFile, file]) {
          try {
            entry?.remove(false);
          } catch {}
        }
      }
      metadata = null;
    },
  };
}
