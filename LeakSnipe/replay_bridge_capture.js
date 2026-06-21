(() => {
  const defaultBase = "http://127.0.0.1:16888";
  const rawBase = window.__LEAKSNIPE_BRIDGE__ || prompt("LeakSnipe bridge URL", defaultBase);
  if (!rawBase) {
    console.warn("LeakSnipe bridge URL not provided.");
    return;
  }

  const base = rawBase.replace(/\/+$/, "");
  const source = window.location.href;
  const canvases = Array.from(document.querySelectorAll("canvas"));
  const bestCanvas = canvases
    .filter((canvas) => canvas.width > 200 && canvas.height > 150)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];

  const postJson = async (path, payload) => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${path} failed: ${response.status} ${text}`);
    }
    return response.json();
  };

  const send = async () => {
    if (bestCanvas) {
      const imageBase64 = bestCanvas.toDataURL("image/png");
      const result = await postJson("/capture/image", {
        image_base64: imageBase64,
        site: "ReplayPoker",
        source,
      });
      console.log("LeakSnipe image capture sent:", result);
      return;
    }

    const text = document.body.innerText.trim();
    if (!text) {
      throw new Error("Replay page did not expose canvas or visible text to capture.");
    }

    const result = await postJson("/capture/text", {
      text,
      site: "ReplayPoker",
      source,
    });
    console.log("LeakSnipe text capture sent:", result);
  };

  send().catch((error) => {
    console.error("LeakSnipe bridge capture failed:", error);
  });
})();
